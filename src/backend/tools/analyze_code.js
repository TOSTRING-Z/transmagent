const fs = require('fs');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

function analyzeFile(filePath, language = 'js') {
  try {
    const code = fs.readFileSync(filePath, 'utf-8');

    // 专门处理PHP文件
    if (language === 'php') {
      // 提取PHP变量（匹配$开头的变量名）
      const phpVars = code.match(/\$[a-zA-Z_\x7f-\xff][a-zA-Z0-9_\x7f-\xff]*/g) || [];
      // 提取PHP函数（匹配function关键字定义的函数）
      const phpFunctions = code.match(/function\s+([a-zA-Z_\x7f-\xff][a-zA-Z0-9_\x7f-\xff]*)\s*\(/g) || [];
      // 提取PHP类（匹配class关键字定义的类）
      const phpClasses = code.match(/class\s+([a-zA-Z_\x7f-\xff][a-zA-Z0-9_\x7f-\xff]*)/g) || [];
      // 提取PHP导入（匹配use关键字）
      const phpImports = code.match(/use\s+([^;]+);/g) || [];

      return {
        file: filePath,
        language: 'php',
        summary: {
          classes: phpClasses.length,
          functions: phpFunctions.length,
          variables: phpVars.length,
          imports: phpImports.length
        },
        details: {
          classes: phpClasses.map(cls => ({
            name: cls.replace('class', '').trim(),
            line: getLineNumber(code, cls),
            methods: [] // PHP类方法需要额外解析，这里留空
          })),
          functions: phpFunctions.map(fn => ({
            name: fn.replace(/function\s+|\s*\(/g, ''),
            line: getLineNumber(code, fn),
            type: 'function'
          })),
          variables: [...new Set(phpVars)].map(name => ({
            name: name,
            line: getLineNumber(code, name),
            type: 'variable'
          })),
          imports: phpImports.map(imp => ({
            source: imp.replace(/^use\s+|\s*;$/g, ''),
            line: getLineNumber(code, imp),
            specifiers: []
          }))
        }
      };
    }

    // 处理Python文件 - 使用正则表达式解析
    if (language === 'python') {
      // 提取Python类（匹配class关键字定义的类）
      const pythonClasses = code.match(/^class\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(?::|\(|$)/gm) || [];
      // 提取Python函数（匹配def关键字定义的函数）
      const pythonFunctions = code.match(/^def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gm) || [];
      // 提取Python变量（匹配赋值语句）
      const pythonVariables = code.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=/gm) || [];
      // 提取Python导入（匹配import和from语句）
      const pythonImports = code.match(/^(?:import|from)\s+[^\n]+/gm) || [];

      return {
        file: filePath,
        language: 'python',
        summary: {
          classes: pythonClasses.length,
          functions: pythonFunctions.length,
          variables: pythonVariables.length,
          imports: pythonImports.length
        },
        details: {
          classes: pythonClasses.map(cls => ({
            name: cls.replace(/^class\s+|\s*(?::|\(|$)/g, '').trim(),
            line: getLineNumber(code, cls),
            methods: [] // Python类方法需要额外解析，这里留空
          })),
          functions: pythonFunctions.map(fn => ({
            name: fn.replace(/^def\s+|\s*\(/g, ''),
            line: getLineNumber(code, fn),
            type: 'function'
          })),
          variables: pythonVariables.map(name => ({
            name: name.replace(/\s*=.*$/, '').trim(),
            line: getLineNumber(code, name),
            type: 'variable'
          })),
          imports: pythonImports.map(imp => ({
            source: imp.trim(),
            line: getLineNumber(code, imp),
            specifiers: []
          }))
        }
      };
    }

    // 处理其他支持的语言（JS/Java）
    const parserConfig = {
      sourceType: 'module',
      plugins: []
    };

    if (language === 'js') {
      parserConfig.plugins.push('jsx', 'typescript');
    } else if (language === 'java') {
      parserConfig.plugins.push('java');
      parserConfig.sourceType = 'script';
    }

    const ast = parser.parse(code, parserConfig);

    const result = {
      file: filePath,
      language: language,
      summary: {
        classes: 0,
        functions: 0,
        variables: 0,
        imports: 0
      },
      details: {
        classes: [],
        functions: [],
        variables: [],
        imports: []
      }
    };

    traverse(ast, {
      ClassDeclaration(nodePath) {
        const classInfo = {
          name: nodePath.node.id.name,
          line: nodePath.node.loc.start.line,
          methods: []
        };

        if (nodePath.node.body && nodePath.node.body.body) {
          classInfo.methods = nodePath.node.body.body
            .filter(m => m.type === 'ClassMethod')
            .map(m => ({
              name: m.key.name,
              line: m.loc.start.line
            }));
        }

        result.details.classes.push(classInfo);
        result.summary.classes++;
      },

      FunctionDeclaration(nodePath) {
        result.details.functions.push({
          name: nodePath.node.id.name,
          line: nodePath.node.loc.start.line,
          type: 'function'
        });
        result.summary.functions++;
      },

      ArrowFunctionExpression(nodePath) {
        if (nodePath.parent.type === 'VariableDeclarator') {
          result.details.functions.push({
            name: nodePath.parent.id.name,
            line: nodePath.node.loc.start.line,
            type: 'arrow'
          });
          result.summary.functions++;
        }
      },

      VariableDeclarator(nodePath) {
        if (nodePath.node.id.type === 'Identifier') {
          result.details.variables.push({
            name: nodePath.node.id.name,
            line: nodePath.node.loc.start.line,
            type: nodePath.parent.kind
          });
          result.summary.variables++;
        }
      },

      ImportDeclaration(nodePath) {
        result.details.imports.push({
          source: nodePath.node.source.value,
          line: nodePath.node.loc.start.line,
          specifiers: nodePath.node.specifiers.map(s => ({
            local: s.local.name,
            imported: s.imported ? s.imported.name : 'default'
          }))
        });
        result.summary.imports++;
      }
    });

    return {
      ...result,
      export: {
        json: () => JSON.stringify(result, null, 2),
        csv: () => {
          let csv = 'Type,Name,Line,Details\n';

          result.details.classes.forEach(c => {
            csv += `class,${c.name},${c.line},"${JSON.stringify(c.methods)}"\n`;
          });

          result.details.functions.forEach(f => {
            csv += `function,${f.name},${f.line},${f.type}\n`;
          });

          result.details.variables.forEach(v => {
            csv += `variable,${v.name},${v.line},${v.type}\n`;
          });

          result.details.imports.forEach(i => {
            csv += `import,${i.source},${i.line},"${i.specifiers.map(s => s.imported).join(',')}"\n`;
          });

          return csv;
        }
      }
    };
  } catch (error) {
    console.error(`Error analyzing file ${filePath}:`, error);
    return {
      file: filePath,
      error: error.message
    };
  }
}

function main({ filePath = "/data/zgr/transagent/model/grpo/grpo_trainer.py", language = 'python' }) {
  const result = analyzeFile(filePath, language);
  // Output pure JSON for better tool integration
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function getPrompt() {
  const prompt = `## analyze_code  

Description: Extracts code structure (classes, functions, variables) from source files  

Supported: JavaScript, Python, Java, PHP  

Parameters:  
- filePath: Source file path (required)  
- language: js/python/java/php (default=js)  

Usage:
{
  "thinking": "[Thinking process]",
  "tool": "analyze_code",
  "params": {
    "filePath": "/src/main.js",
    "language": "js"
  }
}`;
  return prompt;
}

function getLineNumber(code, searchString) {
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(searchString)) {
      return i + 1; // Line numbers start at 1
    }
  }
  return -1; // Return -1 if not found
}

if (require.main === module) {
  // 当直接运行此文件时，执行调试测试
  (async () => {
    try {
      // 示例用法
      const result = await main({
        filePath: "/data/zgr/transagent/model/grpo/grpo_trainer.py",
        language: 'python'
      });
      console.log('调试结果:', JSON.stringify(result, null, 2));
    } catch (error) {
      console.error('调试错误:', error);
    }
  })();
}

module.exports = {
  main,
  getPrompt
};