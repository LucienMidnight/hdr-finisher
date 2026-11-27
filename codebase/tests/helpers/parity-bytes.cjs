// Exact byte parity statistics without allocating or sorting normalized copies.
function summarizeByteParity(differences, off) {
  if (!differences.length || differences.length !== off.length) throw Error("Mismatched parity frames");
  const histogram = new Uint32Array(256);
  const absoluteHistogram = new Uint32Array(256);
  let addedSum = 0, absoluteSum = 0, addedMaximum = 0;
  for (let i = 0; i < differences.length; i++) {
    const value = Math.max(0, differences[i] - off[i]);
    histogram[value]++; absoluteHistogram[differences[i]]++;
    addedSum += value / 255; absoluteSum += differences[i];
    addedMaximum = Math.max(addedMaximum, value);
  }
  const percentile = counts => {
    const target = Math.floor(differences.length * .999);
    let count = 0;
    for (let value = 0; value < counts.length; value++) {
      count += counts[value]; if (count > target) return value;
    }
  };
  const parity = {mean:addedSum/differences.length, p999:percentile(histogram)/255,
    maximum:addedMaximum/255, absoluteMean:absoluteSum/differences.length,
    absoluteP999:percentile(absoluteHistogram)};
  return parity;
}
module.exports = { summarizeByteParity };
