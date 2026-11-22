// Build-time tool (ADR 0017, ADR 0019). Run as: java -cp <nextflow-dist> tools/corpus/src/CommentDump.java <dir>
// Needs a JDK 17 or later. For every `.nf` file under <dir> (sorted by relative path) it builds the AST with nf-lang's
// ScriptAstBuilder, attaches comments with nf-lang's CommentAttacher (the code `nextflow lint -format` prints from) and
// prints one JSON document on stdout:
//   { "files": [ { "file": "main.nf", "comments": [ { "line", "column", "text", "slot", "node": { "class", "line",
//                  "column", "endLine", "endColumn" } } ] }, { "file": "bad.nf", "error": "..." } ] }
// `slot` is leading, trailing or dangling; positions are nf-lang's (1-based, code points). A file the builder rejects has
// an `error` and no `comments`. F-102 compares this with the slots of its own comment attachment over the corpus.

import groovy.json.JsonOutput;
import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import nextflow.script.formatter.Comment;
import nextflow.script.formatter.CommentAttacher;
import nextflow.script.parser.ScriptAstBuilder;
import org.codehaus.groovy.ast.ASTNode;
import org.codehaus.groovy.control.CompilerConfiguration;
import org.codehaus.groovy.control.ErrorCollector;
import org.codehaus.groovy.control.SourceUnit;

public class CommentDump {

    static final List<String> SLOTS = List.of("leading", "trailing", "dangling");

    public static void main(String[] args) throws Exception {
        var root = Path.of(args[0]);
        List<Path> files;
        try (var walk = Files.walk(root)) {
            files = walk
                .filter(p -> Files.isRegularFile(p) && p.getFileName().toString().endsWith(".nf"))
                .sorted(Comparator.comparing(p -> root.relativize(p).toString()))
                .collect(Collectors.toList());
        }
        var out = new ArrayList<Map<String, Object>>();
        for (var file : files) {
            var entry = new LinkedHashMap<String, Object>();
            entry.put("file", root.relativize(file).toString());
            try {
                entry.put("comments", comments(file));
            }
            catch (Throwable t) {
                entry.put("error", String.valueOf(t.getMessage()));
            }
            out.add(entry);
        }
        var result = new LinkedHashMap<String, Object>();
        result.put("files", out);
        System.out.println(JsonOutput.toJson(result));
    }

    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> comments(Path file) throws Exception {
        var text = Files.readString(file);
        var config = new CompilerConfiguration();
        var options = new HashMap<String, Boolean>(config.getOptimizationOptions());
        options.put(ScriptAstBuilder.COMMENTS_OPTION, true);
        config.setOptimizationOptions(options);
        var source = new SourceUnit(file.toString(), text, config, null, new ErrorCollector(config));
        var module = new ScriptAstBuilder(source).buildAST();
        var attacher = CommentAttacher.of(module);
        var rows = new ArrayList<Map<String, Object>>();
        for (var slot : SLOTS) {
            Field field = CommentAttacher.class.getDeclaredField(slot);
            field.setAccessible(true);
            var map = (Map<ASTNode, List<Comment>>) field.get(attacher);
            for (var e : map.entrySet())
                for (var c : e.getValue())
                    rows.add(row(slot, e.getKey(), c));
        }
        rows.sort(Comparator
            .comparing((Map<String, Object> r) -> (Integer) r.get("line"))
            .thenComparing(r -> (Integer) r.get("column"))
            .thenComparing(r -> (String) r.get("slot")));
        return rows;
    }

    static Map<String, Object> row(String slot, ASTNode node, Comment comment) {
        var n = new LinkedHashMap<String, Object>();
        n.put("class", node.getClass().getSimpleName());
        n.put("line", node.getLineNumber());
        n.put("column", node.getColumnNumber());
        n.put("endLine", node.getLastLineNumber());
        n.put("endColumn", node.getLastColumnNumber());
        var r = new LinkedHashMap<String, Object>();
        r.put("line", comment.line);
        r.put("column", comment.column);
        r.put("text", comment.text);
        r.put("slot", slot);
        r.put("node", n);
        return r;
    }
}
