#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const workspaceRoot = process.cwd();

const MAX_CONFIG_APP_LINES = 450;
const MAX_LOCALE_FRAGMENT_LINES = 200;
const MAX_UNUSED_LOCALE_KEYS = 154;

const configFilePath = path.join(workspaceRoot, 'src/config/app.ts');
const localesRoot = path.join(workspaceRoot, 'src/i18n/locales');
const localeDirectoryNames = ['en', 'zh-hans', 'zh-hant'];
const localeLabels = new Map([
    ['en', 'en'],
    ['zh-hans', 'zh-Hans'],
    ['zh-hant', 'zh-Hant'],
]);

function countLines(source) {
    return source.split('\n').length;
}

function extractLocaleKeys(source) {
    const keys = [];
    const keyPattern = /^\s*"([^"]+)":/gm;
    let match = keyPattern.exec(source);
    while (match) {
        keys.push(match[1]);
        match = keyPattern.exec(source);
    }
    return keys;
}

async function loadLocaleFragments(directoryName) {
    const directoryPath = path.join(localesRoot, directoryName);
    const fileNames = (await readdir(directoryPath, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && entry.name !== 'index.ts')
        .map((entry) => entry.name)
        .sort();
    const fragments = [];

    for (const fileName of fileNames) {
        const filePath = path.join(directoryPath, fileName);
        fragments.push({
            fileName,
            filePath,
            source: await readFile(filePath, 'utf8'),
        });
    }

    return fragments;
}

function collectLocaleKeys(locale, fragments, violations) {
    const keys = new Set();
    for (const fragment of fragments) {
        for (const key of extractLocaleKeys(fragment.source)) {
            if (keys.has(key)) {
                violations.push(`${locale} locale has duplicate key: ${key}`);
            }
            keys.add(key);
        }
    }
    return keys;
}

function validateLocaleIndex(locale, indexSource, fragments, violations) {
    for (const fragment of fragments) {
        const domainName = fragment.fileName.replace(/\.ts$/, '');
        const symbol = fragment.source.match(/export const (\w+)/)?.[1];
        if (!symbol) {
            violations.push(`${locale} ${fragment.fileName} does not export a message object`);
            continue;
        }
        if (!indexSource.includes(`import { ${symbol} } from './${domainName}';`)) {
            violations.push(`${locale} index does not import domain: ${fragment.fileName}`);
        }
        if (!indexSource.includes(`...${symbol},`)) {
            violations.push(`${locale} index does not assemble domain: ${fragment.fileName}`);
        }
    }
}

function extractReferencedI18nKeys(source) {
    const keys = new Set();
    const patterns = [
        /\bt\(\s*'([^']+)'/g,
        /\bt\(\s*"([^"]+)"/g,
        /\bt\(\s*`([^$`]+)`/g,
        /\btc\(\s*'([^']+)'/g,
        /\btc\(\s*"([^"]+)"/g,
        /\btc\(\s*`([^$`]+)`/g,
    ];

    for (const pattern of patterns) {
        let match = pattern.exec(source);
        while (match) {
            keys.add(match[1]);
            match = pattern.exec(source);
        }
    }

    return keys;
}

async function listSourceFiles(dirPath) {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
            files.push(...await listSourceFiles(fullPath));
            continue;
        }

        if (!entry.isFile()) {
            continue;
        }

        if (!/\.(ts|tsx)$/.test(entry.name)) {
            continue;
        }

        if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) {
            continue;
        }

        files.push(fullPath);
    }

    return files;
}

async function main() {
    const violations = [];

    const configSource = await readFile(configFilePath, 'utf8');
    const configLines = countLines(configSource);
    if (configLines > MAX_CONFIG_APP_LINES) {
        violations.push(`src/config/app.ts is ${configLines} lines (max ${MAX_CONFIG_APP_LINES})`);
    }

    const localeFragments = new Map();
    for (const directoryName of localeDirectoryNames) {
        const fragments = await loadLocaleFragments(directoryName);
        const locale = localeLabels.get(directoryName);
        if (fragments.length === 0) {
            violations.push(`${locale} locale has no message fragments`);
        }
        localeFragments.set(directoryName, fragments);
        const indexSource = await readFile(path.join(localesRoot, directoryName, 'index.ts'), 'utf8');
        validateLocaleIndex(locale, indexSource, fragments, violations);
        for (const fragment of fragments) {
            const lineCount = countLines(fragment.source);
            if (lineCount > MAX_LOCALE_FRAGMENT_LINES) {
                violations.push(`${path.relative(workspaceRoot, fragment.filePath)} is ${lineCount} lines (max ${MAX_LOCALE_FRAGMENT_LINES})`);
            }
        }
    }

    const baseDomainNames = new Set((localeFragments.get('en') ?? []).map((fragment) => fragment.fileName));
    for (const directoryName of localeDirectoryNames.slice(1)) {
        const locale = localeLabels.get(directoryName);
        const domainNames = new Set((localeFragments.get(directoryName) ?? []).map((fragment) => fragment.fileName));
        for (const domainName of baseDomainNames) {
            if (!domainNames.has(domainName)) {
                violations.push(`${locale} locale is missing domain: ${domainName}`);
            }
        }
        for (const domainName of domainNames) {
            if (!baseDomainNames.has(domainName)) {
                violations.push(`${locale} locale has domain not found in en locale: ${domainName}`);
            }
        }
    }

    const localeKeyMap = new Map();
    for (const directoryName of localeDirectoryNames) {
        const locale = localeLabels.get(directoryName);
        localeKeyMap.set(locale, collectLocaleKeys(locale, localeFragments.get(directoryName) ?? [], violations));
    }

    const baseLocale = 'en';
    const baseKeys = localeKeyMap.get(baseLocale);
    if (!baseKeys) {
        throw new Error('Base locale en.ts is required for consistency check.');
    }

    for (const [locale, keys] of localeKeyMap.entries()) {
        if (locale === baseLocale) {
            continue;
        }

        for (const key of baseKeys) {
            if (!keys.has(key)) {
                violations.push(`${locale} locale is missing key: ${key}`);
            }
        }

        for (const key of keys) {
            if (!baseKeys.has(key)) {
                violations.push(`${locale} locale has key not found in en locale: ${key}`);
            }
        }
    }

    for (const domainName of baseDomainNames) {
        const baseFragment = (localeFragments.get('en') ?? []).find((fragment) => fragment.fileName === domainName);
        const baseDomainKeys = new Set(extractLocaleKeys(baseFragment?.source ?? ''));
        for (const directoryName of localeDirectoryNames.slice(1)) {
            const locale = localeLabels.get(directoryName);
            const fragment = (localeFragments.get(directoryName) ?? []).find((candidate) => candidate.fileName === domainName);
            const domainKeys = new Set(extractLocaleKeys(fragment?.source ?? ''));
            for (const key of baseDomainKeys) {
                if (!domainKeys.has(key)) {
                    violations.push(`${locale} ${domainName} is missing key: ${key}`);
                }
            }
            for (const key of domainKeys) {
                if (!baseDomainKeys.has(key)) {
                    violations.push(`${locale} ${domainName} has key not found in en locale: ${key}`);
                }
            }
        }
    }

    const sourceFiles = await listSourceFiles(path.join(workspaceRoot, 'src'));
    const referencedKeys = new Set();

    for (const sourceFile of sourceFiles) {
        if (sourceFile.includes(`${path.sep}i18n${path.sep}locales${path.sep}`)) {
            continue;
        }

        const source = await readFile(sourceFile, 'utf8');
        const fileKeys = extractReferencedI18nKeys(source);
        for (const key of fileKeys) {
            referencedKeys.add(key);
        }
    }

    const missingReferencedKeys = Array.from(referencedKeys).filter((key) => !baseKeys.has(key));
    for (const key of missingReferencedKeys) {
        violations.push(`Referenced i18n key not found in en locale: ${key}`);
    }

    const unusedKeys = Array.from(baseKeys).filter((key) => !referencedKeys.has(key));
    if (unusedKeys.length > MAX_UNUSED_LOCALE_KEYS) {
        violations.push(`Unused en locale keys: ${unusedKeys.length} (max ${MAX_UNUSED_LOCALE_KEYS})`);
    }

    if (violations.length > 0) {
        console.error('Config/I18n guardrail check failed:');
        for (const violation of violations) {
            console.error(`- ${violation}`);
        }
        process.exit(1);
    }

    console.log('Config/I18n guardrail check passed:');
    console.log(`- src/config/app.ts lines: ${configLines}/${MAX_CONFIG_APP_LINES}`);
    for (const directoryName of localeDirectoryNames) {
        for (const fragment of localeFragments.get(directoryName) ?? []) {
            console.log(`- ${path.relative(workspaceRoot, fragment.filePath)} lines: ${countLines(fragment.source)}/${MAX_LOCALE_FRAGMENT_LINES}`);
        }
    }
    console.log(`- Unused en locale keys: ${unusedKeys.length}/${MAX_UNUSED_LOCALE_KEYS}`);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
