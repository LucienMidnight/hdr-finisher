const fs = require('node:fs/promises');
const path = require('node:path');
const { isProjectPath, pathKey } = require('./validation');

function createRecentProjects(file) {
  let pending = Promise.resolve();
  function inOrder(operation) {
    const result = pending.then(operation);
    // The caller sees errors; a refused operation must not block later work.
    pending = result.catch(() => {});
    return result;
  }
  async function readList() {
    try {
      const stored = JSON.parse(await fs.readFile(file, 'utf8'));
      if (!Array.isArray(stored)) return [];
      const seen = new Set();
      return stored.filter(value => {
        if (typeof value !== 'string' || !path.isAbsolute(value) || !isProjectPath(value)) return false;
        const key = pathKey(value);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 10);
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return [];
      throw error;
    }
  }
  function remember(value) {
    return inOrder(async () => {
      if (!path.isAbsolute(value) || !isProjectPath(value)) throw new Error('Select an HDR Finisher project.');
      const projects = [value, ...(await readList()).filter(item => pathKey(item) !== pathKey(value))].slice(0, 10);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temporary = `${file}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(projects, null, 2));
      await fs.rename(temporary, file);
      return projects;
    });
  }
  return { list: () => inOrder(readList), remember, flush: () => pending };
}
module.exports = { createRecentProjects };
