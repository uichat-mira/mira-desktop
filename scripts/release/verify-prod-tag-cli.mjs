#!/usr/bin/env node
import { verifyProdTag } from './verify-prod-tag.mjs';
try {
  const result = verifyProdTag(process.argv[2], process.argv[3]);
  console.log(`Release provenance PASS: ${result.tag} @ ${result.sha} is in prod history (${result.prodCommit})`);
} catch (error) {
  console.error('Release provenance rejected: ' + error.message);
  process.exitCode = 1;
}
