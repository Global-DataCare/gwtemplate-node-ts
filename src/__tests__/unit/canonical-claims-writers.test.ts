// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const GOVERNED_TEST_MARKER = '// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.';

function isGovernedSource(file: string, sourceText: string): boolean {
  return !file.includes(`${path.sep}__tests__${path.sep}`)
    || sourceText.startsWith(GOVERNED_TEST_MARKER);
}

function propertyName(node: ts.PropertyName | undefined): string | undefined {
  return node && (ts.isIdentifier(node) || ts.isStringLiteral(node)) ? node.text : undefined;
}

function hasProperty(object: ts.ObjectLiteralExpression, name: string): boolean {
  return object.properties.some((property) => propertyName(property.name) === name);
}

function sourceFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(resolved);
    }
    return /\.ts$/.test(entry.name) ? [resolved] : [];
  });
}

function isDirectBundleArrayEntry(object: ts.ObjectLiteralExpression): boolean {
  let current: ts.Node = object;
  while (current.parent && !ts.isSourceFile(current.parent)) {
    if (ts.isArrayLiteralExpression(current.parent)) {
      const arrayProperty = current.parent.parent;
      return ts.isPropertyAssignment(arrayProperty)
        && (propertyName(arrayProperty.name) === 'data' || propertyName(arrayProperty.name) === 'entry');
    }
    if (ts.isObjectLiteralExpression(current.parent)) return false;
    current = current.parent;
  }
  return false;
}

function isBundleEntryWriter(object: ts.ObjectLiteralExpression): boolean {
  if (isDirectBundleArrayEntry(object) || hasProperty(object, 'request') || hasProperty(object, 'response')) {
    return true;
  }
  return hasProperty(object, 'type') && hasProperty(object, 'resource');
}

describe('canonical Bundle entry writer boundary', () => {
  it('rejects governed GW writers that author entry.meta.claims', () => {
    const violations: string[] = [];
    for (const file of sourceFiles(path.resolve('src'))) {
      if (file.includes(`${path.sep}__tests__${path.sep}`)) continue;
      const sourceText = fs.readFileSync(file, 'utf8');
      const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (ts.isObjectLiteralExpression(node) && isBundleEntryWriter(node)) {
          const legacyMeta = node.properties.find((property) => ts.isPropertyAssignment(property)
            && propertyName(property.name) === 'meta'
            && (!ts.isObjectLiteralExpression(property.initializer)
              || hasProperty(property.initializer, 'claims')));
          if (legacyMeta) {
            const location = source.getLineAndCharacterOfPosition(legacyMeta.getStart(source));
            violations.push(`${path.relative(process.cwd(), file)}:${location.line + 1}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(violations).toEqual([]);
  });

  it('rejects duplicated claim keys and identity examples in the governed Composition example', () => {
    const file = path.resolve('src/api-examples/composition.examples.ts');
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const violations: string[] = [];
    const forbiddenLiteral = /^(?:org\.schema\.|[A-Z][A-Za-z]+\.[a-z]|did:|urn:|LOINC\|)/;
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteral(node) && forbiddenLiteral.test(node.text)) {
        const location = source.getLineAndCharacterOfPosition(node.getStart(source));
        violations.push(`${path.relative(process.cwd(), file)}:${location.line + 1}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(violations).toEqual([]);
  });

  it('rejects inline type, resourceType, method and status literals in governed Bundle writers', () => {
    const violations: string[] = [];
    const literalField = (object: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | undefined =>
      object.properties.find((property): property is ts.PropertyAssignment =>
        ts.isPropertyAssignment(property)
        && propertyName(property.name) === name
        && ts.isStringLiteral(property.initializer));
    for (const file of sourceFiles(path.resolve('src'))) {
      const sourceText = fs.readFileSync(file, 'utf8');
      if (!isGovernedSource(file, sourceText)) continue;
      const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (ts.isObjectLiteralExpression(node) && isBundleEntryWriter(node)) {
          const direct = literalField(node, 'type');
          const nested = ['resource', 'request', 'response'].flatMap((containerName) => {
            const container = node.properties.find((property): property is ts.PropertyAssignment =>
              ts.isPropertyAssignment(property)
              && propertyName(property.name) === containerName
              && ts.isObjectLiteralExpression(property.initializer));
            if (!container || !ts.isObjectLiteralExpression(container.initializer)) return [];
            const fieldName = containerName === 'resource'
              ? 'resourceType'
              : containerName === 'request' ? 'method' : 'status';
            return literalField(container.initializer, fieldName) || [];
          });
          for (const property of [direct, ...nested].filter(Boolean) as ts.PropertyAssignment[]) {
            const location = source.getLineAndCharacterOfPosition(property.getStart(source));
            violations.push(`${path.relative(process.cwd(), file)}:${location.line + 1}:${(property.initializer as ts.StringLiteral).text}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(violations).toEqual([]);
  });
});
