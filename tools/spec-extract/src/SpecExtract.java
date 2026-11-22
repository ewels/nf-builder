// Build-time tool (ADR 0020). Run as: java -cp <language-server-all.jar> tools/spec-extract/src/SpecExtract.java <outDir>
// Needs a JDK 17 or later. Dumps the script-side DSL by reflection (classes are loaded without running static
// initialisers) to <outDir>/script.raw.json, and the config spec from the jar's own ConfigSpecFactory to
// <outDir>/config.raw.json. The TypeScript side (cli.ts) normalises both.

import groovy.json.JsonOutput;
import java.io.IOException;
import java.lang.annotation.Annotation;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.Parameter;
import java.lang.reflect.Type;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.function.Predicate;
import java.util.jar.JarFile;
import nextflow.config.spec.SpecNode;
import nextflow.lsp.spec.ConfigSpecFactory;

public class SpecExtract {

    static final String DSL = "nextflow.script.dsl.";
    static final String NAMESPACES = "nextflow.script.namespaces.";
    static final String TYPES = "nextflow.script.types.";
    static final ClassLoader LOADER = SpecExtract.class.getClassLoader();

    public static void main(String[] args) throws Exception {
        if (args.length != 1) {
            System.err.println("usage: java -cp <language-server-all.jar> SpecExtract.java <outDir>");
            System.exit(2);
        }
        Path out = Path.of(args[0]);
        Files.createDirectories(out);
        write(out.resolve("script.raw.json"), script());
        write(out.resolve("config.raw.json"), config());
    }

    static void write(Path file, Object value) throws IOException {
        Files.writeString(file, JsonOutput.toJson(value));
    }

    // ---- script side -------------------------------------------------------------------------------------------

    static Class<?> load(String name) throws ClassNotFoundException {
        return Class.forName(name, false, LOADER);
    }

    static Map<String, Object> script() throws Exception {
        Map<String, Object> out = new LinkedHashMap<>();
        Class<?> scriptDsl = load(DSL + "ScriptDsl");
        out.put("directives", entries(load(DSL + "ProcessDsl$DirectiveDsl"), m -> true, null));
        Map<String, Object> sections = new LinkedHashMap<>();
        sections.put("inputs", entries(load(DSL + "ProcessDsl$InputDslV1"), m -> true, null));
        sections.put("outputs", entries(load(DSL + "ProcessDsl$OutputDslV1"), m -> true, null));
        sections.put("typedOutputs", entries(load(DSL + "ProcessDsl$OutputDslV2"), m -> true, null));
        sections.put("stage", entries(load(DSL + "ProcessDsl$StageDsl"), m -> true, null));
        out.put("processSections", sections);
        out.put("agentDirectives", entries(load(DSL + "AgentDsl$DirectiveDsl"), m -> true, null));

        List<Object> operators = new ArrayList<>();
        for (String receiver : new String[] {"Channel", "Value"}) {
            Class<?> type = load(TYPES + receiver);
            for (Map<String, Object> entry : entries(type, m -> hasAnnotation(m, "Operator"), null)) {
                entry.put("receiver", receiver);
                operators.add(entry);
            }
        }
        out.put("operators", operators);
        out.put("factories", entries(load(NAMESPACES + "ChannelNamespace"), m -> true, null));
        out.put("constants", entries(scriptDsl, m -> constantName(m) != null, SpecExtract::constantName));
        out.put("functions", entries(scriptDsl, m -> constantName(m) == null, null));

        List<Object> namespaces = new ArrayList<>();
        for (String name : new String[] {"Log", "Workflow", "Nextflow", "Manifest"})
            namespaces.add(group(name.toLowerCase(), load(NAMESPACES + name + "Namespace")));
        out.put("namespaces", namespaces);
        out.put("types", types());
        out.put("featureFlags", featureFlags(load(DSL + "FeatureFlagDsl")));
        return out;
    }

    /** The value of the first annotation named `simpleName` (from nextflow.script.dsl) on the element, or null. */
    static Annotation annotation(java.lang.reflect.AnnotatedElement element, String simpleName) {
        for (Annotation a : element.getAnnotations())
            if (a.annotationType().getName().equals(DSL + simpleName)) return a;
        return null;
    }

    static boolean hasAnnotation(java.lang.reflect.AnnotatedElement element, String simpleName) {
        return annotation(element, simpleName) != null;
    }

    static String annotationValue(java.lang.reflect.AnnotatedElement element, String simpleName) {
        Annotation a = annotation(element, simpleName);
        if (a == null) return null;
        try {
            return (String) a.annotationType().getMethod("value").invoke(a);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException(e);
        }
    }

    static String constantName(Method m) {
        return annotationValue(m, "Constant");
    }

    /** `getBuild` is the property `build`. */
    static String propertyName(Method m) {
        String n = m.getName();
        if (n.length() > 3 && n.startsWith("get") && m.getParameterCount() == 0 && Character.isUpperCase(n.charAt(3)))
            return Character.toLowerCase(n.charAt(3)) + n.substring(4);
        return n;
    }

    /**
     * One entry per method name: the description from the first overload that has one, one signature per overload.
     * Only names with at least one overload accepted by the filter are kept.
     */
    static List<Map<String, Object>> entries(Class<?> type, Predicate<Method> any, java.util.function.Function<Method, String> naming) {
        Map<String, List<Method>> byName = new TreeMap<>();
        for (Method m : type.getDeclaredMethods()) {
            if (m.isSynthetic() || m.isBridge() || Modifier.isStatic(m.getModifiers())) continue;
            String name = naming != null && naming.apply(m) != null ? naming.apply(m) : propertyName(m);
            byName.computeIfAbsent(name, k -> new ArrayList<>()).add(m);
        }
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map.Entry<String, List<Method>> e : byName.entrySet()) {
            // getDeclaredMethods has no defined order and differs between JVM builds; the description is taken from
            // the first overload that has one, so put the overloads in a stable order first.
            List<Method> methods = new ArrayList<>(e.getValue());
            methods.sort(Comparator.comparing((Method m) -> signature(m).toString()));
            if (methods.stream().noneMatch(any)) continue;
            String description = "";
            for (Method m : methods) {
                String d = annotationValue(m, "Description");
                if (d != null && !d.isBlank()) {
                    description = d;
                    break;
                }
            }
            List<Object> signatures = new ArrayList<>();
            for (Method m : methods) signatures.add(signature(m));
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("name", e.getKey());
            entry.put("description", description);
            entry.put("signatures", signatures);
            out.add(entry);
        }
        return out;
    }

    static Map<String, Object> signature(Method m) {
        Type[] types = m.getGenericParameterTypes();
        Parameter[] parameters = m.getParameters();
        List<Object> params = new ArrayList<>();
        for (int i = 0; i < types.length; i++) {
            String type = typeName(types[i]);
            if (m.isVarArgs() && i == types.length - 1 && type.endsWith("[]"))
                type = type.substring(0, type.length() - 2) + "...";
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("name", parameters[i].getName());
            p.put("type", type);
            params.add(p);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("parameters", params);
        out.put("returns", typeName(m.getGenericReturnType()));
        out.put("varargs", m.isVarArgs());
        out.put("deprecated", m.isAnnotationPresent(Deprecated.class));
        return out;
    }

    /**
     * `java.util.Map<java.lang.String, ?>` becomes `Map<String, ?>`; nested classes use a dot. Parameterised types are
     * rendered here because the jar's own ParameterizedType implementation has no toString.
     */
    static String typeName(Type type) {
        if (type instanceof java.lang.reflect.ParameterizedType p) {
            List<String> args = new ArrayList<>();
            for (Type a : p.getActualTypeArguments()) args.add(typeName(a));
            return typeName(p.getRawType()) + "<" + String.join(", ", args) + ">";
        }
        if (type instanceof java.lang.reflect.GenericArrayType a) return typeName(a.getGenericComponentType()) + "[]";
        return type.getTypeName().replaceAll("\\b(?:[a-z_][A-Za-z0-9_]*\\.)+", "").replace('$', '.');
    }

    static Map<String, Object> group(String name, Class<?> type) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("name", name);
        String description = annotationValue(type, "Description");
        out.put("description", description == null ? "" : description);
        out.put("members", entries(type, m -> true, null));
        return out;
    }

    /** Classes under nextflow/script/types/ (and shim/) that carry a class-level @Description, from the jar's entries. */
    static List<Object> types() throws Exception {
        String jar = System.getProperty("java.class.path").split(java.io.File.pathSeparator)[0];
        List<String> names = new ArrayList<>();
        try (JarFile file = new JarFile(jar)) {
            file.stream().forEach(entry -> {
                String n = entry.getName();
                if (n.startsWith("nextflow/script/types/") && n.endsWith(".class")) names.add(n);
            });
        }
        names.sort(Comparator.naturalOrder());
        List<Object> out = new ArrayList<>();
        for (String n : names) {
            Class<?> type = load(n.substring(0, n.length() - ".class".length()).replace('/', '.'));
            if (!hasAnnotation(type, "Description")) continue;
            String name = type.getName().substring(TYPES.length()).replace('$', '.');
            out.add(group(name, type));
        }
        return out;
    }

    static List<Object> featureFlags(Class<?> type) {
        List<Object> out = new ArrayList<>();
        for (Field f : type.getDeclaredFields()) {
            String name = annotationValue(f, "FeatureFlag");
            if (name == null) continue;
            String description = annotationValue(f, "Description");
            Map<String, Object> flag = new LinkedHashMap<>();
            flag.put("name", name);
            flag.put("description", description == null ? "" : description);
            flag.put("type", typeName(f.getGenericType()));
            flag.put("preview", name.startsWith("nextflow.preview."));
            out.add(flag);
        }
        return out;
    }

    // ---- config side -------------------------------------------------------------------------------------------

    static List<Object> config() {
        return nodes(ConfigSpecFactory.defaultScopes());
    }

    static List<Object> nodes(Map<String, SpecNode> children) {
        List<Object> out = new ArrayList<>();
        for (Map.Entry<String, SpecNode> e : children.entrySet()) out.add(node(e.getKey(), e.getValue()));
        return out;
    }

    static Map<String, Object> node(String name, SpecNode node) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("name", name);
        out.put("description", node.description() == null ? "" : node.description());
        if (node instanceof SpecNode.Scope scope) {
            out.put("kind", "scope");
            out.put("children", nodes(scope.children()));
        } else if (node instanceof SpecNode.Option option) {
            out.put("kind", "option");
            List<Object> types = new ArrayList<>();
            for (Type t : option.types()) types.add(typeName(t));
            out.put("types", types);
        } else if (node instanceof SpecNode.Placeholder placeholder) {
            out.put("kind", "placeholder");
            out.put("placeholderName", placeholder.placeholderName());
            out.put("children", nodes(placeholder.scope().children()));
        } else if (node instanceof SpecNode.DslOption dsl) {
            out.put("kind", "dsl");
            out.put("dsl", typeName(dsl.dsl()));
        } else {
            throw new IllegalStateException("unknown spec node " + node.getClass());
        }
        return out;
    }
}
