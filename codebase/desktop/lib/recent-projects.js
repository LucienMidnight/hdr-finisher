const fs = require('node:fs');
const path = require('node:path');
const { isProjectPath, pathKey } = require('./validation');

function createRecentProjects(file) {
  function list() {
    try {
      const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
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
    if (!path.isAbsolute(value) || !isProjectPath(value)) throw new Error('Select an HDR Finisher project.');
    const projects = [value, ...list().filter(item => pathKey(item) !== pathKey(value))].slice(0, 10);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(projects, null, 2));
    fs.renameSync(temporary, file);
    return projects;
  }
  return { list, remember };
}
module.exports = { createRecentProjects };
