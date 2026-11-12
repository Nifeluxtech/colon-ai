// Test fixtures (sample pages and API answers) live in tests/fixtures/ as plain files.
const fs = require('fs');
const path = require('path');

const fixture = (name) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8');

module.exports = { fixture };
