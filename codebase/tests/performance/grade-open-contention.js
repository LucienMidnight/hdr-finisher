// Same full RAW import idle and during real cancellable paste preparation.
// Every import re-develops the RAW; OS caches are not flushed. See report conditions.
process.argv.push('--contention');
require('./raw-import-baseline.js').main().catch(error=>{console.error(error);process.exitCode=1;});
