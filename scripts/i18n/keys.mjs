#!/usr/bin/env node
/**
 * Every English catalog key the extension uses, one per line (stdout).
 *
 * Keys: the first string literal of each t('...') / tf('...') call in src/,
 * and the lines of scripts/i18n/extra_keys.txt (text shown through
 * t(variable), such as panel status labels).
 *
 *   node scripts/i18n/keys.mjs > /tmp/ext-keys.txt
 */
import { allKeys } from './lib.mjs';

process.stdout.write(allKeys().join('\n') + '\n');
