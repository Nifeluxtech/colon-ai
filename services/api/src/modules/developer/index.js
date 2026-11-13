// Developer mode (Phase 5): project-files context for code questions. The prompt itself lives in ai/prompts.js.
//   snapshot  a .zip project read safely at upload time and stored as JSON (chat_attachments.text)
//   project   the budgeted context block built for every Developer reply from all code files in the conversation
//   rules     ignore rules, skip reasons and language detection
const snapshot = require('./snapshot');
const project = require('./project');
const rules = require('./rules');

module.exports = {
  fromZip: snapshot.fromZip, parseSnapshot: snapshot.parse,
  contextFor: project.contextFor, render: project.render, isProjectFile: project.isProjectFile,
  snapshot, project, rules,
};
