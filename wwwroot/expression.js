(() => {
  'use strict';

  class ExpressionError extends Error {
    constructor(message, position = 0) {
      super(`${message}${Number.isFinite(position) ? `（位置 ${position + 1}）` : ''}`);
      this.name = 'ExpressionError';
      this.position = position;
    }
  }

  const isNameStart = char => /[\p{L}_]/u.test(char || '');
  const isNamePart = char => /[\p{L}\p{N}_]/u.test(char || '');

  function tokenize(source) {
    const tokens = [];
    let index = 0;
    while (index < source.length) {
      const char = source[index];
      if (/\s/.test(char)) {
        index += 1;
        continue;
      }

      if (char === '[') {
        const start = index;
        index += 1;
        let name = '';
        while (index < source.length && source[index] !== ']') {
          name += source[index];
          index += 1;
        }
        if (source[index] !== ']') throw new ExpressionError('缺少右方括号 ]', start);
        index += 1;
        if (!name.trim()) throw new ExpressionError('数值名称不能为空', start);
        tokens.push({ type: 'variable', value: name.trim(), position: start });
        continue;
      }

      if (/\d/.test(char) || (char === '.' && /\d/.test(source[index + 1] || ''))) {
        const start = index;
        const match = source.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
        const raw = match?.[0] || '';
        index += raw.length;
        tokens.push({ type: 'number', value: Number(raw), position: start });
        continue;
      }

      if (isNameStart(char)) {
        const start = index;
        let name = '';
        while (index < source.length && isNamePart(source[index])) {
          name += source[index];
          index += 1;
        }
        const upper = name.toUpperCase();
        const keywordMap = {
          AND: '&&', OR: '||', XOR: 'XOR', NOT: '!', TRUE: 'TRUE', FALSE: 'FALSE',
          且: '&&', 或: '||', 异或: 'XOR', 非: '!'
        };
        if (keywordMap[upper] || keywordMap[name]) {
          tokens.push({ type: 'operator', value: keywordMap[upper] || keywordMap[name], position: start });
        } else {
          tokens.push({ type: 'identifier', value: name, position: start });
        }
        continue;
      }

      const two = source.slice(index, index + 2);
      if (['&&', '||', '>=', '<=', '==', '!='].includes(two)) {
        tokens.push({ type: 'operator', value: two, position: index });
        index += 2;
        continue;
      }
      if (['+', '-', '*', '/', '%', '>', '<', '!', '^', '(', ')', ','].includes(char)) {
        tokens.push({
          type: ['(', ')', ','].includes(char) ? 'punctuation' : 'operator',
          value: char === '^' ? 'XOR' : char,
          position: index
        });
        index += 1;
        continue;
      }
      const symbolMap = { '=': '==', '≥': '>=', '≤': '<=', '≠': '!=', '＝': '==' };
      if (symbolMap[char]) {
        tokens.push({ type: 'operator', value: symbolMap[char], position: index });
        index += 1;
        continue;
      }
      throw new ExpressionError(`无法识别“${char}”`, index);
    }
    tokens.push({ type: 'eof', value: '', position: source.length });
    return tokens;
  }

  class Parser {
    constructor(source) {
      this.source = source;
      this.tokens = tokenize(source);
      this.index = 0;
    }

    current() { return this.tokens[this.index]; }
    match(value) {
      if (this.current().value !== value) return false;
      this.index += 1;
      return true;
    }
    consume(value, message) {
      if (!this.match(value)) throw new ExpressionError(message, this.current().position);
    }

    parse() {
      if (!this.source.trim()) throw new ExpressionError('表达式不能为空', 0);
      const node = this.parseOr();
      if (this.current().type !== 'eof') throw new ExpressionError(`“${this.current().value}”后存在多余内容`, this.current().position);
      return node;
    }

    parseOr() {
      let node = this.parseXor();
      while (this.match('||')) node = { type: 'binary', operator: '||', left: node, right: this.parseXor() };
      return node;
    }

    parseXor() {
      let node = this.parseAnd();
      while (this.match('XOR')) node = { type: 'binary', operator: 'XOR', left: node, right: this.parseAnd() };
      return node;
    }

    parseAnd() {
      let node = this.parseComparison();
      while (this.match('&&')) node = { type: 'binary', operator: '&&', left: node, right: this.parseComparison() };
      return node;
    }

    parseComparison() {
      let node = this.parseAdditive();
      const operators = ['>=', '<=', '==', '!=', '>', '<'];
      if (operators.includes(this.current().value)) {
        const operator = this.current().value;
        this.index += 1;
        node = { type: 'binary', operator, left: node, right: this.parseAdditive() };
      }
      return node;
    }

    parseAdditive() {
      let node = this.parseMultiplicative();
      while (['+', '-'].includes(this.current().value)) {
        const operator = this.current().value;
        this.index += 1;
        node = { type: 'binary', operator, left: node, right: this.parseMultiplicative() };
      }
      return node;
    }

    parseMultiplicative() {
      let node = this.parseUnary();
      while (['*', '/', '%'].includes(this.current().value)) {
        const operator = this.current().value;
        this.index += 1;
        node = { type: 'binary', operator, left: node, right: this.parseUnary() };
      }
      return node;
    }

    parseUnary() {
      if (['!', '+', '-'].includes(this.current().value)) {
        const operator = this.current().value;
        this.index += 1;
        return { type: 'unary', operator, argument: this.parseUnary() };
      }
      return this.parsePrimary();
    }

    parsePrimary() {
      const token = this.current();
      if (token.type === 'number') {
        this.index += 1;
        return { type: 'number', value: token.value };
      }
      if (token.type === 'variable') {
        this.index += 1;
        return { type: 'variable', name: token.value };
      }
      if (token.value === 'TRUE' || token.value === 'FALSE') {
        this.index += 1;
        return { type: 'boolean', value: token.value === 'TRUE' };
      }
      if (token.type === 'identifier') {
        this.index += 1;
        if (this.match('(')) {
          const args = [];
          if (!this.match(')')) {
            do { args.push(this.parseOr()); } while (this.match(','));
            this.consume(')', '函数调用缺少右括号 )');
          }
          return { type: 'call', name: token.value.toLowerCase(), args, position: token.position };
        }
        return { type: 'variable', name: token.value };
      }
      if (this.match('(')) {
        const node = this.parseOr();
        this.consume(')', '缺少右括号 )');
        return node;
      }
      throw new ExpressionError(`此处不能使用“${token.value || '表达式结尾'}”`, token.position);
    }
  }

  function parse(source) {
    return new Parser(String(source || '')).parse();
  }

  function asNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new ExpressionError('计算结果不是有效数值', NaN);
    return number;
  }

  function evaluate(node, resolveVariable) {
    switch (node.type) {
      case 'number': return node.value;
      case 'boolean': return node.value;
      case 'variable': {
        const value = resolveVariable(node.name);
        if (value === undefined) throw new ExpressionError(`未定义数值“${node.name}”`, NaN);
        return asNumber(value);
      }
      case 'unary': {
        const value = evaluate(node.argument, resolveVariable);
        if (node.operator === '!') return !Boolean(value);
        if (node.operator === '-') return -asNumber(value);
        return asNumber(value);
      }
      case 'binary': {
        if (node.operator === '&&') return Boolean(evaluate(node.left, resolveVariable)) && Boolean(evaluate(node.right, resolveVariable));
        if (node.operator === '||') return Boolean(evaluate(node.left, resolveVariable)) || Boolean(evaluate(node.right, resolveVariable));
        if (node.operator === 'XOR') return Boolean(evaluate(node.left, resolveVariable)) !== Boolean(evaluate(node.right, resolveVariable));
        const left = evaluate(node.left, resolveVariable);
        const right = evaluate(node.right, resolveVariable);
        switch (node.operator) {
          case '+': return asNumber(left) + asNumber(right);
          case '-': return asNumber(left) - asNumber(right);
          case '*': return asNumber(left) * asNumber(right);
          case '/': {
            const divisor = asNumber(right);
            if (divisor === 0) throw new ExpressionError('不能除以 0', NaN);
            return asNumber(left) / divisor;
          }
          case '%': {
            const divisor = asNumber(right);
            if (divisor === 0) throw new ExpressionError('不能对 0 取余', NaN);
            return asNumber(left) % divisor;
          }
          case '>': return asNumber(left) > asNumber(right);
          case '>=': return asNumber(left) >= asNumber(right);
          case '<': return asNumber(left) < asNumber(right);
          case '<=': return asNumber(left) <= asNumber(right);
          case '==': return left === right || (Number.isFinite(Number(left)) && Number(left) === Number(right));
          case '!=': return !(left === right || (Number.isFinite(Number(left)) && Number(left) === Number(right)));
          default: throw new ExpressionError(`不支持运算符 ${node.operator}`, NaN);
        }
      }
      case 'call': {
        const args = node.args.map(argument => evaluate(argument, resolveVariable));
        switch (node.name) {
          case 'min':
            if (!args.length) throw new ExpressionError('min() 至少需要 1 个参数', NaN);
            return asNumber(Math.min(...args.map(asNumber)));
          case 'max':
            if (!args.length) throw new ExpressionError('max() 至少需要 1 个参数', NaN);
            return asNumber(Math.max(...args.map(asNumber)));
          case 'abs': return Math.abs(asNumber(args[0]));
          case 'round': return Math.round(asNumber(args[0]));
          case 'floor': return Math.floor(asNumber(args[0]));
          case 'ceil': return Math.ceil(asNumber(args[0]));
          case 'sqrt': return asNumber(Math.sqrt(asNumber(args[0])));
          case 'pow': {
            if (args.length !== 2) throw new ExpressionError('pow() 需要 2 个参数', NaN);
            return asNumber(Math.pow(asNumber(args[0]), asNumber(args[1])));
          }
          case 'clamp': {
            if (args.length !== 3) throw new ExpressionError('clamp() 需要 3 个参数', NaN);
            return Math.min(asNumber(args[2]), Math.max(asNumber(args[1]), asNumber(args[0])));
          }
          case 'between': {
            if (args.length !== 3) throw new ExpressionError('between() 需要 3 个参数', NaN);
            const value = asNumber(args[0]);
            return value >= asNumber(args[1]) && value <= asNumber(args[2]);
          }
          case 'outside': {
            if (args.length !== 3) throw new ExpressionError('outside() 需要 3 个参数', NaN);
            const value = asNumber(args[0]);
            return value < asNumber(args[1]) || value > asNumber(args[2]);
          }
          default: throw new ExpressionError(`不支持函数“${node.name}”`, node.position ?? NaN);
        }
      }
      default: throw new ExpressionError('无法计算该表达式', NaN);
    }
  }

  function collectVariables(node, target = new Set()) {
    if (!node) return target;
    if (node.type === 'variable') target.add(node.name);
    if (node.type === 'unary') collectVariables(node.argument, target);
    if (node.type === 'binary') {
      collectVariables(node.left, target);
      collectVariables(node.right, target);
    }
    if (node.type === 'call') node.args.forEach(argument => collectVariables(argument, target));
    return target;
  }

  function validate(source, availableNames = []) {
    try {
      const ast = parse(source);
      const names = collectVariables(ast);
      const available = new Set(availableNames);
      const missing = [...names].filter(name => !available.has(name));
      if (missing.length) return { valid: false, error: `未定义数值：${missing.join('、')}`, ast, variables: [...names] };
      return { valid: true, ast, variables: [...names] };
    } catch (error) {
      return { valid: false, error: error instanceof Error ? error.message : String(error), ast: null, variables: [] };
    }
  }

  function evaluateSource(source, values, definitions) {
    const result = validate(source, definitions.map(item => item.name));
    if (!result.valid) throw new ExpressionError(result.error, NaN);
    const byName = new Map(definitions.map(item => [item.name, item.id]));
    return evaluate(result.ast, name => values[byName.get(name)]);
  }

  function referencesVariable(source, name) {
    if (!String(source || '').trim()) return false;
    try { return collectVariables(parse(source)).has(name); }
    catch { return String(source).includes(`[${name}]`) || String(source).includes(name); }
  }

  function renameVariable(source, oldName, newName) {
    return String(source || '').split(`[${oldName}]`).join(`[${newName}]`);
  }

  window.StoryExpression = { ExpressionError, parse, evaluate, validate, evaluateSource, collectVariables, referencesVariable, renameVariable };
})();
