'use strict';

const fs = require('node:fs/promises');

module.exports = async function tempDirectory(prefix) {
  const root = await fs.mkdtemp(prefix);
  try {
    // Hosted Windows runners may expose TEMP through an 8.3 profile alias.
    // Match the canonical paths returned by the native filesystem resolver.
    return await fs.realpath(root);
  } catch (error) {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
};
