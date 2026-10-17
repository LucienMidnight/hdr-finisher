// Release-set lens check: the lens preview/export comparison in --quick mode.
// The complete matrix (tests/lens-filter-parity.js) runs in the full tier.
process.argv.push("--quick");
require("./lens-filter-parity.js");
