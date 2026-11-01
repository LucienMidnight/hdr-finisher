// A slow log disk must not turn native WriteStream buffers into an unbounded
// photo-history cache. Under overload, omit diagnostics and report the count.
function create(stream, limit = 1024 * 1024) {
  let omitted = 0;
  const summary = () => {
    if (!omitted) return;
    const count = omitted; omitted = 0;
    stream.write(`[library] log_overload ${JSON.stringify({time:Date.now()/1000,omitted:count})}\n`);
  };
  stream.on('drain', summary);
  return line => {
    const text = line + '\n';
    if (stream.writableLength + Buffer.byteLength(text) > limit) { omitted++; return false; }
    summary();
    stream.write(text);
    return true;
  };
}
module.exports = {create};
