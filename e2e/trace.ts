// Reads a Chromium performance trace (F-113 step 2): how many CPU profile samples and module compiles land on each
// thread for the scripts a predicate picks (the parser chunks).

interface TraceEvent {
  ph?: string;
  name?: string;
  pid?: number;
  tid?: number;
  id?: string;
  args?: {
    name?: string;
    fileName?: string;
    url?: string;
    data?: {
      cpuProfile?: {
        nodes?: { id: number; callFrame?: { url?: string } }[];
        samples?: number[];
      };
    };
  };
}

export interface ThreadActivity {
  samples: number;
  compiles: number;
}

/** Per thread name; threads with no match are present with zeros. Throws on a trace with no thread names or profiles. */
export function scriptActivity(
  trace: unknown,
  isTarget: (url: string) => boolean,
): Map<string, ThreadActivity> {
  const events: TraceEvent[] = Array.isArray(trace)
    ? trace
    : ((trace as { traceEvents?: TraceEvent[] }).traceEvents ?? []);
  const names = new Map<string, string>();
  const key = (e: TraceEvent) => `${e.pid}:${e.tid}`;
  for (const e of events)
    if (e.ph === "M" && e.name === "thread_name" && e.args?.name)
      names.set(key(e), e.args.name);
  if (names.size === 0) throw new Error("The trace has no thread names");
  if (!events.some((e) => e.name === "Profile"))
    throw new Error(
      "The trace has no Profile events (is the CPU profiler category on?)",
    );

  const activity = new Map<string, ThreadActivity>();
  for (const name of names.values())
    activity.set(name, { samples: 0, compiles: 0 });
  const entry = (e: TraceEvent) => activity.get(names.get(key(e)) ?? "");

  // Chromium emits ProfileChunk events from a profiler thread; the `Profile` event with the same pid and id is on the
  // sampled thread. A profile's nodes and samples can arrive in different chunks.
  const profileKey = (e: TraceEvent) => `${e.pid}:${e.id}`;
  const sampled = new Map<string, ThreadActivity | undefined>();
  for (const e of events)
    if (e.name === "Profile") sampled.set(profileKey(e), entry(e));
  const targets = new Map<string, Set<number>>();
  for (const e of events) {
    if (e.name !== "ProfileChunk") continue;
    const set = targets.get(profileKey(e)) ?? new Set<number>();
    targets.set(profileKey(e), set);
    for (const node of e.args?.data?.cpuProfile?.nodes ?? [])
      if (isTarget(node.callFrame?.url ?? "")) set.add(node.id);
  }
  for (const e of events) {
    if (e.name === "ProfileChunk") {
      const thread = sampled.get(profileKey(e));
      const set = targets.get(profileKey(e));
      for (const id of e.args?.data?.cpuProfile?.samples ?? [])
        if (thread && set?.has(id)) thread.samples += 1;
    } else if (e.name === "v8.compileModule") {
      const thread = entry(e);
      if (thread && isTarget(e.args?.fileName ?? e.args?.url ?? ""))
        thread.compiles += 1;
    }
  }
  return activity;
}
