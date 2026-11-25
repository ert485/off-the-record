// Shared by the projector and the phones: a teaser line where ~~words~~ are
// shown struck through (still readable). An unpaired ~~ stays as it is.

export function struckParts(line) {
  const parts = [];
  const push = (text, struck) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last && last.struck === struck) last.text += text;
    else parts.push({ text, struck });
  };
  let rest = String(line ?? '');
  for (let m; (m = /~~([^~]+?)~~/.exec(rest)); rest = rest.slice(m.index + m[0].length)) {
    push(rest.slice(0, m.index), false);
    push(m[1], true);
  }
  push(rest, false);
  return parts;
}
