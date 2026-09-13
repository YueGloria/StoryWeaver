(() => {
  'use strict';

  const Expr = window.StoryExpression;
  const SCHEMA = 'storyweaver.project.v2';
  const MAX_UNIQUE_STATES = 5000;

  const uid = prefix => `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
  const clone = value => JSON.parse(JSON.stringify(value));
  const nowIso = () => new Date().toISOString();
  const finiteNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

  function newEffect(variableId = '') {
    return { id: uid('effect'), variableId, operator: 'add', operandType: 'number', operandValue: 0, operandVariableId: '' };
  }

  function newValueOption(name = '选项 1') {
    return { id: uid('option'), name: String(name || '未命名选项'), effects: [] };
  }

  function newCondition(variableId = '') {
    return {
      id: uid('condition'), type: 'condition', negate: false, leftVariableId: variableId,
      comparator: '>=', rightType: 'number', rightValue: 0, rightVariableId: '', rangeEnd: 0
    };
  }

  function newGroup(variableId = '') {
    return { id: uid('group'), type: 'group', operator: 'AND', negate: false, children: variableId ? [newCondition(variableId)] : [] };
  }

  function newLock(variableId = '') {
    return { enabled: false, mode: 'builder', builder: newGroup(variableId), expression: '' };
  }

  function createDefaultProject() {
    const rootId = uid('node');
    return {
      schema: SCHEMA,
      formatVersion: 2,
      meta: { title: '未命名文游', createdAt: nowIso(), updatedAt: nowIso() },
      rootId,
      numberDefinitions: [],
      nodes: [{ id: rootId, kind: 'root', title: '故事起点', notes: '', effects: [], createdAt: nowIso() }],
      branchLines: []
    };
  }

  function normalizeEffect(raw, definitionIds) {
    const operators = ['add', 'subtract', 'multiply', 'divide', 'set', 'floorAt', 'capAt'];
    return {
      id: String(raw?.id || uid('effect')),
      variableId: definitionIds.has(raw?.variableId) ? raw.variableId : '',
      operator: operators.includes(raw?.operator) ? raw.operator : 'add',
      operandType: raw?.operandType === 'variable' ? 'variable' : 'number',
      operandValue: finiteNumber(raw?.operandValue),
      operandVariableId: definitionIds.has(raw?.operandVariableId) ? raw.operandVariableId : ''
    };
  }

  function normalizeValueOption(raw, index, definitionIds) {
    const fallbackName = `选项 ${index + 1}`;
    return {
      id: String(raw?.id || uid('option')),
      name: String(raw?.name ?? fallbackName).trim() || fallbackName,
      effects: Array.isArray(raw?.effects) ? raw.effects.map(effect => normalizeEffect(effect, definitionIds)) : []
    };
  }

  function normalizeLockItem(raw, definitionIds) {
    if (raw?.type === 'group') {
      return {
        id: String(raw.id || uid('group')), type: 'group',
        operator: ['AND', 'OR', 'XOR'].includes(raw.operator) ? raw.operator : 'AND',
        negate: Boolean(raw.negate),
        children: Array.isArray(raw.children) ? raw.children.map(item => normalizeLockItem(item, definitionIds)) : []
      };
    }
    return {
      id: String(raw?.id || uid('condition')), type: 'condition', negate: Boolean(raw?.negate),
      leftVariableId: definitionIds.has(raw?.leftVariableId) ? raw.leftVariableId : '',
      comparator: ['==', '!=', '>', '>=', '<', '<=', 'between', 'outside'].includes(raw?.comparator) ? raw.comparator : '>=',
      rightType: raw?.rightType === 'variable' ? 'variable' : 'number',
      rightValue: finiteNumber(raw?.rightValue),
      rightVariableId: definitionIds.has(raw?.rightVariableId) ? raw.rightVariableId : '',
      rangeEnd: finiteNumber(raw?.rangeEnd)
    };
  }

  function normalizeProject(input) {
    const raw = input?.project && input.project.nodes ? input.project : input;
    if (!raw || !Array.isArray(raw.nodes)) throw new Error('文件中没有可识别的节点数据。');

    const definitions = Array.isArray(raw.numberDefinitions)
      ? raw.numberDefinitions.map(item => ({ id: String(item.id || uid('number')), name: String(item.name || '未命名数值').trim() || '未命名数值', initialValue: finiteNumber(item.initialValue) }))
      : [];
    const seenNames = new Set();
    definitions.forEach((item, index) => {
      let name = item.name;
      let suffix = 2;
      while (seenNames.has(name)) name = `${item.name}${suffix++}`;
      item.name = name;
      seenNames.add(name);
      if (!item.id) item.id = uid(`number-${index}`);
    });
    const definitionIds = new Set(definitions.map(item => item.id));

    const nodes = raw.nodes.map((item, index) => {
      const kind = item.kind === 'value' ? 'value' : item.kind === 'root' ? 'root' : 'story';
      const legacyEffects = Array.isArray(item.effects) ? item.effects.map(effect => normalizeEffect(effect, definitionIds)) : [];
      let valueOptions = [];
      if (kind === 'value') {
        if (Array.isArray(item.valueOptions)) {
          valueOptions = item.valueOptions.map((option, optionIndex) => normalizeValueOption(option, optionIndex, definitionIds));
        } else {
          const migrated = newValueOption(legacyEffects.length ? '原有数值调整' : '选项 1');
          migrated.effects = legacyEffects;
          valueOptions = [migrated];
        }
      }
      return {
        id: String(item.id || uid('node')),
        kind,
        title: String(item.title ?? (kind === 'value' ? '数值选择' : '新节点')),
        notes: String(item.notes ?? ''),
        effects: kind === 'value' ? [] : legacyEffects,
        valueOptions,
        createdAt: String(item.createdAt || nowIso()),
        sortIndex: finiteNumber(item.sortIndex, index)
      };
    });
    if (!nodes.length) throw new Error('项目至少需要一个元节点。');
    const nodeIds = new Set(nodes.map(item => item.id));
    let rootId = nodeIds.has(raw.rootId) ? String(raw.rootId) : nodes.find(item => item.kind === 'root')?.id || nodes[0].id;
    nodes.forEach(item => { if (item.id !== rootId && item.kind === 'root') item.kind = 'story'; });
    nodes.find(item => item.id === rootId).kind = 'root';

    const branchLines = (Array.isArray(raw.branchLines) ? raw.branchLines : [])
      .filter(item => nodeIds.has(item.sourceId) && nodeIds.has(item.targetId) && item.sourceId !== item.targetId)
      .map(item => ({
        id: String(item.id || uid('line')), sourceId: String(item.sourceId), targetId: String(item.targetId),
        label: String(item.label ?? ''),
        effects: Array.isArray(item.effects) ? item.effects.map(effect => normalizeEffect(effect, definitionIds)) : [],
        lock: {
          enabled: Boolean(item.lock?.enabled),
          mode: item.lock?.mode === 'advanced' ? 'advanced' : 'builder',
          builder: normalizeLockItem(item.lock?.builder || newGroup(definitions[0]?.id || ''), definitionIds),
          expression: String(item.lock?.expression || '')
        },
        createdAt: String(item.createdAt || nowIso())
      }));

    const normalized = {
      schema: SCHEMA,
      formatVersion: 2,
      meta: {
        title: String(raw.meta?.title || '未命名文游'),
        createdAt: String(raw.meta?.createdAt || nowIso()),
        updatedAt: String(raw.meta?.updatedAt || nowIso())
      },
      rootId, numberDefinitions: definitions, nodes, branchLines
    };
    if (topologicalOrder(normalized).hasCycle) throw new Error('导入失败：剧情图中存在循环连接。');
    return normalized;
  }

  function getNode(project, id) { return project.nodes.find(item => item.id === id); }
  function getLine(project, id) { return project.branchLines.find(item => item.id === id); }
  function getDefinition(project, id) { return project.numberDefinitions.find(item => item.id === id); }

  function outgoingLines(project, nodeId) { return project.branchLines.filter(line => line.sourceId === nodeId); }
  function incomingLines(project, nodeId) { return project.branchLines.filter(line => line.targetId === nodeId); }

  function reachableSet(project, excludedLineId = null) {
    const reached = new Set([project.rootId]);
    const queue = [project.rootId];
    while (queue.length) {
      const sourceId = queue.shift();
      project.branchLines.forEach(line => {
        if (line.id === excludedLineId || line.sourceId !== sourceId || reached.has(line.targetId)) return;
        reached.add(line.targetId);
        queue.push(line.targetId);
      });
    }
    return reached;
  }

  function topologicalOrder(project) {
    const nodeOrder = new Map(project.nodes.map((node, index) => [node.id, index]));
    const indegree = new Map(project.nodes.map(node => [node.id, 0]));
    project.branchLines.forEach(line => indegree.set(line.targetId, (indegree.get(line.targetId) || 0) + 1));
    const queue = project.nodes.filter(node => indegree.get(node.id) === 0).sort((a, b) => nodeOrder.get(a.id) - nodeOrder.get(b.id));
    const result = [];
    while (queue.length) {
      const node = queue.shift();
      result.push(node.id);
      outgoingLines(project, node.id).forEach(line => {
        indegree.set(line.targetId, indegree.get(line.targetId) - 1);
        if (indegree.get(line.targetId) === 0) {
          queue.push(getNode(project, line.targetId));
          queue.sort((a, b) => nodeOrder.get(a.id) - nodeOrder.get(b.id));
        }
      });
    }
    return { order: result, hasCycle: result.length !== project.nodes.length };
  }

  function wouldCreateCycle(project, sourceId, targetId) {
    if (sourceId === targetId) return true;
    const reached = new Set([targetId]);
    const queue = [targetId];
    while (queue.length) {
      const current = queue.shift();
      if (current === sourceId) return true;
      outgoingLines(project, current).forEach(line => {
        if (!reached.has(line.targetId)) {
          reached.add(line.targetId);
          queue.push(line.targetId);
        }
      });
    }
    return false;
  }

  function compareValues(left, comparator, right, rangeEnd) {
    switch (comparator) {
      case '==': return left === right;
      case '!=': return left !== right;
      case '>': return left > right;
      case '>=': return left >= right;
      case '<': return left < right;
      case '<=': return left <= right;
      case 'between': return left >= Math.min(right, rangeEnd) && left <= Math.max(right, rangeEnd);
      case 'outside': return left < Math.min(right, rangeEnd) || left > Math.max(right, rangeEnd);
      default: return false;
    }
  }

  function evaluateBuilderItem(item, values) {
    if (item.type === 'group') {
      const results = item.children.map(child => Boolean(evaluateBuilderItem(child, values)));
      let result;
      if (!results.length) result = true;
      else if (item.operator === 'OR') result = results.some(Boolean);
      else if (item.operator === 'XOR') result = results.filter(Boolean).length === 1;
      else result = results.every(Boolean);
      return item.negate ? !result : result;
    }
    if (!item.leftVariableId || values[item.leftVariableId] === undefined) throw new Error('数值锁引用了不存在的数值类。');
    const left = values[item.leftVariableId];
    let right;
    if (item.rightType === 'variable') {
      if (!item.rightVariableId || values[item.rightVariableId] === undefined) throw new Error('数值锁右侧引用了不存在的数值类。');
      right = values[item.rightVariableId];
    } else {
      right = finiteNumber(item.rightValue);
    }
    const result = compareValues(left, item.comparator, right, finiteNumber(item.rangeEnd));
    return item.negate ? !result : result;
  }

  function evaluateLock(lock, values, definitions) {
    if (!lock?.enabled) return true;
    if (lock.mode === 'advanced') return Boolean(Expr.evaluateSource(lock.expression, values, definitions));
    return Boolean(evaluateBuilderItem(lock.builder, values));
  }

  function readOperand(effect, values) {
    if (effect.operandType === 'variable') {
      if (!effect.operandVariableId || values[effect.operandVariableId] === undefined) throw new Error('数值变化引用了不存在的数值类。');
      return values[effect.operandVariableId];
    }
    return finiteNumber(effect.operandValue);
  }

  function applyEffects(state, effects) {
    const next = {
      values: { ...state.values },
      ways: state.ways,
      path: [...(state.path || [])],
      choices: [...(state.choices || [])]
    };
    for (const effect of effects || []) {
      if (!effect.variableId || next.values[effect.variableId] === undefined) throw new Error('数值变化的目标数值类不存在。');
      const current = next.values[effect.variableId];
      const operand = readOperand(effect, next.values);
      let value;
      switch (effect.operator) {
        case 'subtract': value = current - operand; break;
        case 'multiply': value = current * operand; break;
        case 'divide':
          if (operand === 0) throw new Error('数值变化不能除以 0。');
          value = current / operand;
          break;
        case 'set': value = operand; break;
        case 'floorAt': value = Math.max(current, operand); break;
        case 'capAt': value = Math.min(current, operand); break;
        default: value = current + operand;
      }
      if (!Number.isFinite(value)) throw new Error('数值变化得到了无效结果。');
      next.values[effect.variableId] = value;
    }
    return next;
  }

  function getValueOptions(node) {
    if (!node || node.kind !== 'value') return [];
    if (Array.isArray(node.valueOptions)) return node.valueOptions;
    if (Array.isArray(node.effects) && node.effects.length) {
      return [{ id: `legacy-${node.id}`, name: '原有数值调整', effects: node.effects }];
    }
    return [];
  }

  function stateKey(state, definitions) {
    return definitions.map(definition => {
      const value = state.values[definition.id];
      return Number.isFinite(value) ? Number(value.toPrecision(12)) : 'NaN';
    }).join('|');
  }

  function appendState(stateMap, nodeId, state, definitions, warnings) {
    const states = stateMap.get(nodeId) || [];
    const key = stateKey(state, definitions);
    const existing = states.find(item => item.key === key);
    if (existing) {
      existing.ways = Math.min(Number.MAX_SAFE_INTEGER, existing.ways + state.ways);
    } else if (states.length < MAX_UNIQUE_STATES) {
      states.push({ ...state, key });
    } else {
      warnings.add(`节点“${nodeId}”的可能状态超过 ${MAX_UNIQUE_STATES} 种，显示范围可能不完整。`);
    }
    stateMap.set(nodeId, states);
  }

  function calculate(project) {
    const topo = topologicalOrder(project);
    const structuralReachable = reachableSet(project);
    const statesByNode = new Map(project.nodes.map(node => [node.id, []]));
    const edgeStats = new Map(project.branchLines.map(line => [line.id, { evaluated: 0, passed: 0, blocked: 0, errors: [] }]));
    const errors = new Set();
    const warnings = new Set();
    const initialValues = Object.fromEntries(project.numberDefinitions.map(item => [item.id, finiteNumber(item.initialValue)]));
    appendState(statesByNode, project.rootId, { values: initialValues, ways: 1, path: [], choices: [] }, project.numberDefinitions, warnings);

    for (const nodeId of topo.order) {
      const sourceStates = statesByNode.get(nodeId) || [];
      for (const line of outgoingLines(project, nodeId)) {
        const stats = edgeStats.get(line.id);
        const target = getNode(project, line.targetId);
        for (const state of sourceStates) {
          stats.evaluated = Math.min(Number.MAX_SAFE_INTEGER, stats.evaluated + state.ways);
          let allowed = false;
          try {
            allowed = evaluateLock(line.lock, state.values, project.numberDefinitions);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!stats.errors.includes(message)) stats.errors.push(message);
            errors.add(`分支线“${line.label || '未命名分支线'}”：${message}`);
          }
          if (!allowed) {
            stats.blocked = Math.min(Number.MAX_SAFE_INTEGER, stats.blocked + state.ways);
            continue;
          }
          try {
            let next = applyEffects(state, line.effects);
            next.path.push(line.id);
            stats.passed = Math.min(Number.MAX_SAFE_INTEGER, stats.passed + state.ways);
            const options = getValueOptions(target);
            if (target?.kind === 'value' && options.length) {
              options.forEach((option, optionIndex) => {
                try {
                  const optionState = applyEffects(next, option.effects);
                  optionState.choices.push({ nodeId: target.id, optionId: option.id, optionName: option.name || `选项 ${optionIndex + 1}` });
                  appendState(statesByNode, line.targetId, optionState, project.numberDefinitions, warnings);
                } catch (error) {
                  const message = error instanceof Error ? error.message : String(error);
                  errors.add(`数值节点“${target.title || '未命名数值节点'}”的选项“${option.name || `选项 ${optionIndex + 1}`}”：${message}`);
                }
              });
            } else {
              next = applyEffects(next, target?.kind === 'value' ? [] : target?.effects || []);
              appendState(statesByNode, line.targetId, next, project.numberDefinitions, warnings);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!stats.errors.includes(message)) stats.errors.push(message);
            stats.blocked = Math.min(Number.MAX_SAFE_INTEGER, stats.blocked + state.ways);
            errors.add(`分支线“${line.label || '未命名分支线'}”：${message}`);
          }
        }
      }
    }

    const nodeResults = new Map();
    project.nodes.forEach(node => {
      const states = statesByNode.get(node.id) || [];
      const values = {};
      project.numberDefinitions.forEach(definition => {
        const possible = states.map(state => state.values[definition.id]).filter(Number.isFinite);
        values[definition.id] = possible.length
          ? { min: Math.min(...possible), max: Math.max(...possible), exact: Math.min(...possible) === Math.max(...possible) }
          : null;
      });
      nodeResults.set(node.id, {
        reachable: states.length > 0,
        structuralReachable: structuralReachable.has(node.id),
        possibleStateCount: states.length,
        pathCount: states.reduce((total, state) => Math.min(Number.MAX_SAFE_INTEGER, total + state.ways), 0),
        values,
        states
      });
    });

    return { nodeResults, edgeStats, errors: [...errors], warnings: [...warnings], structuralReachable, hasCycle: topo.hasCycle };
  }

  function edgeLabelWidth(label) {
    const text = String(label || '').trim();
    if (!text) return 0;
    const glyphWidth = Array.from(text).reduce((total, character) => {
      if (/\s/u.test(character)) return total + 4.5;
      if (/[^\u0000-\u00ff]/u.test(character)) return total + 13;
      if (/[MW@#%&]/u.test(character)) return total + 10;
      if (/[ilI1|.,'`:;]/u.test(character)) return total + 4;
      return total + 7.2;
    }, 0);
    return Math.max(62, Math.ceil(glyphWidth + 18));
  }

  function layoutGraph(project) {
    const topo = topologicalOrder(project);
    const depths = new Map(project.nodes.map(node => [node.id, node.id === project.rootId ? 0 : 0]));
    topo.order.forEach(nodeId => {
      const depth = depths.get(nodeId) || 0;
      outgoingLines(project, nodeId).forEach(line => depths.set(line.targetId, Math.max(depths.get(line.targetId) || 0, depth + 1)));
    });
    const levels = new Map();
    project.nodes.forEach((node, index) => {
      const depth = depths.get(node.id) || 0;
      if (!levels.has(depth)) levels.set(depth, []);
      levels.get(depth).push({ node, index });
    });
    const maxCount = Math.max(1, ...[...levels.values()].map(items => items.length));
    const worldHeight = Math.max(700, maxCount * 146 + 150);
    const maxDepth = Math.max(0, ...depths.values());
    const nodeSizes = new Map(project.nodes.map(node => [node.id, {
      width: node.kind === 'value' ? 204 : 220,
      height: node.kind === 'value' ? 104 : 108
    }]));
    const columnWidths = new Map();
    project.nodes.forEach(node => {
      const depth = depths.get(node.id) || 0;
      columnWidths.set(depth, Math.max(columnWidths.get(depth) || 0, nodeSizes.get(node.id).width));
    });
    const columnX = new Map([[0, 70]]);
    for (let depth = 1; depth <= maxDepth; depth += 1) {
      const previousX = columnX.get(depth - 1) || 70;
      const previousWidth = columnWidths.get(depth - 1) || 220;
      let nextX = previousX + previousWidth + 126;
      project.branchLines.forEach(line => {
        const targetDepth = depths.get(line.targetId) || 0;
        const sourceDepth = depths.get(line.sourceId) || 0;
        if (targetDepth !== depth || sourceDepth >= targetDepth || !columnX.has(sourceDepth)) return;
        const sourceSize = nodeSizes.get(line.sourceId) || { width: 220 };
        const requiredGap = Math.max(126, edgeLabelWidth(line.label) + 56);
        nextX = Math.max(nextX, columnX.get(sourceDepth) + sourceSize.width + requiredGap);
      });
      columnX.set(depth, nextX);
    }
    const positions = new Map();

    [...levels.entries()].sort((a, b) => a[0] - b[0]).forEach(([depth, items]) => {
      items.sort((a, b) => a.index - b.index);
      const span = (items.length - 1) * 146;
      const firstCenter = worldHeight / 2 - span / 2;
      items.forEach((entry, itemIndex) => {
        const { width, height } = nodeSizes.get(entry.node.id);
        positions.set(entry.node.id, { x: columnX.get(depth) || 70, y: firstCenter + itemIndex * 146 - height / 2, width, height, depth });
      });
    });
    const rightEdge = Math.max(0, ...[...positions.values()].map(position => position.x + position.width));
    const worldWidth = Math.max(980, rightEdge + 270);
    return { positions, width: worldWidth, height: worldHeight, depths, columnX };
  }

  function formatNumber(value) {
    if (!Number.isFinite(value)) return '—';
    if (Object.is(value, -0)) value = 0;
    return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 }).format(value);
  }

  function formatRange(range) {
    if (!range) return '不可达';
    return range.exact ? formatNumber(range.min) : `${formatNumber(range.min)}～${formatNumber(range.max)}`;
  }

  function effectToText(effect, project) {
    const target = getDefinition(project, effect.variableId)?.name || '未选择数值';
    const operand = effect.operandType === 'variable'
      ? `[${getDefinition(project, effect.operandVariableId)?.name || '未选择数值'}]`
      : formatNumber(finiteNumber(effect.operandValue));
    const labels = { add: '+', subtract: '−', multiply: '×', divide: '÷', set: '=', floorAt: '不低于', capAt: '不高于' };
    return `${target} ${labels[effect.operator] || '+'} ${operand}`;
  }

  function conditionToText(item, project) {
    if (item.type === 'group') {
      if (!item.children.length) return '始终允许';
      const separator = item.operator === 'OR' ? ' 或 ' : item.operator === 'XOR' ? ' 异或 ' : ' 且 ';
      const text = item.children.map(child => conditionToText(child, project)).join(separator);
      return item.negate ? `非（${text}）` : `（${text}）`;
    }
    const left = getDefinition(project, item.leftVariableId)?.name || '未选择数值';
    let text;
    if (item.comparator === 'between' || item.comparator === 'outside') {
      text = `${left}${item.comparator === 'between' ? '处于' : '不在'} ${formatNumber(finiteNumber(item.rightValue))}～${formatNumber(finiteNumber(item.rangeEnd))}`;
    } else {
      const right = item.rightType === 'variable'
        ? getDefinition(project, item.rightVariableId)?.name || '未选择数值'
        : formatNumber(finiteNumber(item.rightValue));
      const labels = { '==': '=', '!=': '≠', '>': '>', '>=': '≥', '<': '<', '<=': '≤' };
      text = `${left} ${labels[item.comparator] || item.comparator} ${right}`;
    }
    return item.negate ? `非（${text}）` : text;
  }

  function lockToText(line, project) {
    if (!line.lock?.enabled) return '无数值锁';
    return line.lock.mode === 'advanced' ? line.lock.expression || '未填写表达式' : conditionToText(line.lock.builder, project);
  }

  function lockItemUsesVariable(item, variableId) {
    if (!item) return false;
    if (item.type === 'group') return item.children.some(child => lockItemUsesVariable(child, variableId));
    return item.leftVariableId === variableId || (item.rightType === 'variable' && item.rightVariableId === variableId);
  }

  function effectUsesVariable(effect, variableId) {
    return effect.variableId === variableId || (effect.operandType === 'variable' && effect.operandVariableId === variableId);
  }

  function countReferences(project, variableId) {
    const definition = getDefinition(project, variableId);
    const nodeIds = new Set(project.nodes.filter(node => {
      if ((node.effects || []).some(effect => effectUsesVariable(effect, variableId))) return true;
      return getValueOptions(node).some(option => (option.effects || []).some(effect => effectUsesVariable(effect, variableId)));
    }).map(node => node.id));
    const lineIds = new Set(project.branchLines.filter(line => {
      if (line.effects.some(effect => effectUsesVariable(effect, variableId))) return true;
      if (!line.lock?.enabled) return false;
      if (line.lock.mode === 'advanced') return Expr.referencesVariable(line.lock.expression, definition?.name || '');
      return lockItemUsesVariable(line.lock.builder, variableId);
    }).map(line => line.id));
    return { nodeCount: nodeIds.size, lineCount: lineIds.size, nodeIds: [...nodeIds], lineIds: [...lineIds] };
  }

  function pruneLockItem(item, variableId) {
    if (item.type !== 'group') return lockItemUsesVariable(item, variableId) ? null : item;
    item.children = item.children.map(child => pruneLockItem(child, variableId)).filter(Boolean);
    return item;
  }

  function removeVariableReferences(project, variableId, variableName) {
    project.nodes.forEach(node => {
      node.effects = (node.effects || []).filter(effect => !effectUsesVariable(effect, variableId));
      getValueOptions(node).forEach(option => {
        option.effects = (option.effects || []).filter(effect => !effectUsesVariable(effect, variableId));
      });
    });
    project.branchLines.forEach(line => {
      line.effects = line.effects.filter(effect => !effectUsesVariable(effect, variableId));
      if (line.lock.mode === 'advanced' && Expr.referencesVariable(line.lock.expression, variableName)) {
        line.lock.enabled = false;
        line.lock.expression = '';
      } else {
        line.lock.builder = pruneLockItem(line.lock.builder, variableId) || newGroup(project.numberDefinitions.find(item => item.id !== variableId)?.id || '');
      }
    });
  }

  function findLockItem(root, id, parent = null) {
    if (!root) return null;
    if (root.id === id) return { item: root, parent };
    if (root.type === 'group') {
      for (const child of root.children) {
        const found = findLockItem(child, id, root);
        if (found) return found;
      }
    }
    return null;
  }

  function buildAiExport(project, calculation = calculate(project)) {
    const computedNode = node => {
      const result = calculation.nodeResults.get(node.id);
      return Object.fromEntries(project.numberDefinitions.map(definition => [definition.name, result?.values[definition.id]
        ? { minimum: result.values[definition.id].min, maximum: result.values[definition.id].max, exact: result.values[definition.id].exact }
        : null]));
    };
    return {
      schema: SCHEMA,
      formatVersion: 2,
      description: '这是剧情脉络导出的文游有向剧情图。剧情节点表示结构路径；数值节点用 valueOptions 表示互斥选项，这些选项只改变数值并共享同一组后续分支线；branchLines 表示有方向的剧情转移；数值锁应针对每条实际状态逐条判断。',
      meta: clone(project.meta),
      rootId: project.rootId,
      numberDefinitions: clone(project.numberDefinitions),
      nodes: project.nodes.map(node => {
        const valueOptions = getValueOptions(node);
        return {
          ...clone(node),
          valueOptions: node.kind === 'value' ? clone(valueOptions) : [],
          computedState: {
            reachable: calculation.nodeResults.get(node.id)?.reachable || false,
            pathCount: calculation.nodeResults.get(node.id)?.pathCount || 0,
            possibleValues: computedNode(node)
          },
          numericChangesReadable: (node.effects || []).map(effect => effectToText(effect, project)),
          valueOptionsReadable: node.kind === 'value' ? valueOptions.map((option, index) => ({
            id: option.id,
            name: option.name || `选项 ${index + 1}`,
            numericChanges: (option.effects || []).map(effect => effectToText(effect, project))
          })) : []
        };
      }),
      branchLines: project.branchLines.map(line => ({
        ...clone(line),
        fromNodeName: getNode(project, line.sourceId)?.title || '',
        toNodeName: getNode(project, line.targetId)?.title || '',
        numericChangesReadable: line.effects.map(effect => effectToText(effect, project)),
        numericLockReadable: lockToText(line, project)
      })),
      analysisSnapshot: {
        generatedAt: nowIso(),
        unreachableBecauseOfNumericLocks: project.nodes
          .filter(node => node.id !== project.rootId)
          .filter(node => {
            const result = calculation.nodeResults.get(node.id);
            return result?.structuralReachable && !result.reachable;
          })
          .map(node => ({ id: node.id, name: node.title })),
        calculationErrors: calculation.errors,
        calculationWarnings: calculation.warnings
      },
      aiReadingGuide: {
        direction: '每条分支线从 sourceId 指向 targetId，元节点由 rootId 指定。',
        numericOrder: '路径先检查分支线数值锁，通过后应用分支线数值变化；若目标是数值节点，则从 valueOptions 中互斥选择一组并按顺序应用该组 effects。',
        valueNodeChoices: '数值节点的每个 valueOptions 条目代表一个互斥选项。每次只选一项，各项会产生不同数值状态，但不创建不同剧情分支；所有结果继续使用该数值节点已有的共同出分支线。空 valueOptions 表示数值不变并直接继续。',
        convergence: '一个节点拥有多条入分支线时表示收束；computedState.possibleValues 给出全部有效路径汇聚后的理论上下限。',
        xor: '可视化条件组中的 XOR 表示其直接子条件中恰好一个成立。高级表达式中的 XOR/^ 是二元异或。'
      }
    };
  }

  window.StoryModel = {
    SCHEMA, uid, clone, nowIso, finiteNumber, createDefaultProject, normalizeProject,
    newEffect, newValueOption, newCondition, newGroup, newLock, getNode, getLine, getDefinition, getValueOptions,
    outgoingLines, incomingLines, reachableSet, topologicalOrder, wouldCreateCycle,
    calculate, edgeLabelWidth, layoutGraph, formatNumber, formatRange, effectToText, conditionToText, lockToText,
    countReferences, removeVariableReferences, findLockItem, buildAiExport
  };
})();
