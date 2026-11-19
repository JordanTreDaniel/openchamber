// Authored by hand, not generated: vq is a pointer format (`source` names a
// JSON file on disk), so there is no component catalog to build the text from
// and no reason for it to grow with one. Every session pays for it, so it
// stays a third of the block guidance: when vq beats the other ask surfaces,
// the object's keys, the `source` pointer, and one example.
export const VQ_GUIDANCE = [
  "vq: a ```vq fence in your reply holds one JSON object; the component it draws collects the user's judgment and returns it as your next turn.",
  '{v: 1, type, id, title?, prompt?, explain?, source?, output?}. type: pick, duel, random, scale, split, plane, rank, assign, table, graph, tree, map, canvas, when, timeline, field, recorder; the rest are component props.',
  'source points at the data: {path, select?, where?, limit?, fields?, idField?}. path is an absolute path to JSON on disk, select a dot path into it, fields maps a record to props (detail may be a "{token}" template), idField its key. items, options, rows come from it. output: where results land, {kind: "dir" | "r2", path?, remote?, prefix?, audio?, markdown?}.',
  'When:',
  '- judgment over many items on disk (triage a list, verdict per row, rank a queue, divide a budget): vq;',
  '- showing something (chart, status, summary), choosing among a few options: openui-lang;',
  "- a decision setting the work's direction: openchamber_render with ui, for its note field;",
  '- a quick clarification its options fully answer: the question tool.',
  'Never paste rows into the fence: on disk, pass source.path; else openui-lang or openchamber_render.',
  'Example:',
  '```vq\n{"v":1,"type":"assign","id":"deck","title":"Assign backlog","source":{"path":"/work/backlog.json","select":"items","fields":{"label":"title","detail":"{team} · {points} pt"},"idField":"id"}}\n```',
].join('\n');
