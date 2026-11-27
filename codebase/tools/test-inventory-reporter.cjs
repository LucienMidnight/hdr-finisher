// Node's event stream supplies the actual file, expanded test count and duration.
module.exports = async function* (events) {
  for await (const { type, data } of events) {
    if (type === 'test:pass' || type === 'test:fail') {
      yield JSON.stringify({ type, ...data }) + '\n';
    }
  }
};
