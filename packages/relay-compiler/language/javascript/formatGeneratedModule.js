/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

// flowlint ambiguous-object-type:error

'use strict';

import type {FormatModule} from '../RelayLanguagePluginInterface';

// ESModule support is achieved via a regex replacement of the require statements.
// this is super hacky but this was the simplest solution with the current compiler
// architecture
const requireRegex = /require\('(.*)'\)/g;

const getImportedQueryTargets = concreteText => {
  let matches;
  let output = [];
  while ((matches = requireRegex.exec(concreteText))) {
    output.push(matches[1]);
  }
  return output;
};

const buildModuleIdentifierMap = importPaths => {
  const result = {};
  importPaths.forEach(path => {
    const identifier = path.replace(/[^a-zA-Z]/g, '_');
    result[path] = identifier;
  });
  return result;
};

const printExternalQueryImports = moduleIdentifierMap => {
  let result = [];
  Object.keys(moduleIdentifierMap).forEach(path => {
    const id = moduleIdentifierMap[path];
    result.push(`import ${id} from '${path}';`);
  });
  return result.join('\n');
};

const replaceRequiresWithImportIdentifiers = (
  concreteText,
  moduleIdentifierMap,
) => {
  return concreteText.replace(requireRegex, (_, path) => {
    return moduleIdentifierMap[path];
  });
};

const formatGeneratedModule: FormatModule = ({
  moduleName,
  documentType,
  docText,
  concreteText,
  typeText,
  hash,
  sourceHash,
  importText,
}) => {
  const documentTypeImport = documentType
    ? `import type { ${documentType} } from 'relay-runtime';`
    : '';
  const docTextComment =
    docText != null ? '\n/*\n' + docText.trim() + '\n*/\n' : '';
  const hashText = hash != null ? `\n * ${hash}` : '';
  return `/**
 * ${'@'}flow${hashText}
 */

/* eslint-disable */

'use strict';

/*::
${documentTypeImport}
${typeText || ''}
*/

${importText || ''}

${docTextComment}
const node/*: ${documentType || 'empty'}*/ = ${concreteText};
// prettier-ignore
(node/*: any*/).hash = '${sourceHash}';
`;
};

const formatGeneratedCommonjsModule: FormatModule = options => {
  return `${formatGeneratedModule(options)}
module.exports = node;
`;
};

const formatGeneratedESModule: FormatModule = ({concreteText, ...options}) => {
  const importPaths = getImportedQueryTargets(concreteText);
  const moduleIdentifierMap = buildModuleIdentifierMap(importPaths);

  const topLevelQueryImport = printExternalQueryImports(moduleIdentifierMap);
  const esModuleConcreteText = replaceRequiresWithImportIdentifiers(
    concreteText,
    moduleIdentifierMap,
  );

  const formattedModule = formatGeneratedModule({
    ...options,
    concreteText: esModuleConcreteText,
    importText: topLevelQueryImport,
  });
  return `${formattedModule}
export default node;
`;
};

exports.formatGeneratedCommonjsModule = formatGeneratedCommonjsModule;
exports.formatGeneratedESModule = formatGeneratedESModule;
