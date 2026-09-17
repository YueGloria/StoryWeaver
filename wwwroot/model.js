(() => {
  'use strict';

  const Expr = window.StoryExpression;
  const SCHEMA = 'storyweaver.project.v3';
  const MAX_UNIQUE_STATES = 5000;
  const NOTE_POSITIONS = new Set(['top', 'right', 'bottom', 'left']);
  const THEME_PRESETS = new Set(['midnight', 'paper', 'ember', 'forest', 'contrast', 'mist', 'cream', 'mint', 'rose', 'custom']);
  const THEME_COLOR_KEYS = new Set([
    'background', 'panel', 'surface', 'canvas', 'grid', 'text', 'muted', 'accent',
    'storyNode', 'storyBorder', 'rootNode', 'rootBorder', 'valueNode', 'valueBorder',
    'branchLine', 'branchSelected', 'noteBackground', 'noteBorder', 'noteText',
    'branchPalette1', 'branchPalette2', 'branchPalette3', 'branchPalette4',
    'branchPalette5', 'branchPalette6', 'branchPalette7', 'branchPalette8'
  ]);

  const uid = prefix => `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
  const clone = value => JSON.parse(JSON.stringify(value));
  const nowIso = () => new Date().toISOString();
  const finiteNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const validHexColor = value => /^#[0-9a-f]{6}$/i.test(String(value || ''));

  function newLineRoute() {
    return { mode: 'auto', points: [] };
  }

  function defaultViewSettings() {
    return {
      notes: { enabled: false, position: 'right' },
      branchColors: { enabled: true },
      nodeOffsets: {},
      theme: { preset: 'midnight', savedPresetId: '', colors: {} }
    };
  }

  function normalizeViewSettings(raw) {
    const defaults = defaultViewSettings();
    const source = raw && typeof raw === 'object' ? raw : {};
    const preset = THEME_PRESETS.has(source.theme?.preset) ? source.theme.preset : defaults.theme.preset;
    const colors = {};
    if (source.theme?.colors && typeof source.theme.colors === 'object') {
      Object.entries(source.theme.colors).forEach(([key, value]) => {
        if (THEME_COLOR_KEYS.has(key) && validHexColor(value)) colors[key] = String(value).toUpperCase();
      });
    }
    const nodeOffsets = {};
    if (source.nodeOffsets && typeof source.nodeOffsets === 'object' && !Array.isArray(source.nodeOffsets)) {
      Object.entries(source.nodeOffsets).slice(0, 10000).forEach(([nodeId, offset]) => {
        const x = Number(offset?.x);
        const y = Number(offset?.y);
        if (!nodeId || !Number.isFinite(x) || !Number.isFinite(y)) return;
        const normalized = {
          x: Math.round(Math.max(-100000, Math.min(100000, x))),
          y: Math.round(Math.max(-100000, Math.min(100000, y)))
        };
        if (normalized.x || normalized.y) nodeOffsets[String(nodeId)] = normalized;
      });
    }
    return {
      notes: {
        enabled: Boolean(source.notes?.enabled),
        position: NOTE_POSITIONS.has(source.notes?.position) ? source.notes.position : defaults.notes.position
      },
      branchColors: { enabled: source.branchColors?.enabled !== false },
      nodeOffsets,
      theme: {
        preset,
        savedPresetId: preset === 'custom' ? String(source.theme?.savedPresetId || '').slice(0, 120) : '',
        colors
      }
    };
  }

  function normalizeLineRoute(raw) {
    const points = Array.isArray(raw?.points) ? raw.points.slice(0, 32)
      .map(point => ({ x: Number(point?.x), y: Number(point?.y) }))
      .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
      .map(point => ({
        x: Math.max(0, Math.min(100000, point.x)),
        y: Math.max(0, Math.min(100000, point.y))
      })) : [];
    return { mode: raw?.mode === 'manual' ? 'manual' : 'auto', points };
  }

  function newEffect(variableId = '') {
    return { id: uid('effect'), variableId, operator: 'add', operandType: 'number', operandValue: 0, operandVariableId: '' };
  }

  function newValueOption(name = '选项 1') {
    return { id: uid('option'), name: String(name || '未命名选项'), effects: [] };
  }

  function newNumberGroup(name = '新分组') {
    return { id: uid('number-group'), name: String(name || '新分组'), collapsed: false };
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
      formatVersion: 3,
      meta: { title: '未命名文游', createdAt: nowIso(), updatedAt: nowIso() },
      rootId,
      viewSettings: defaultViewSettings(),
      numberGroups: [],
      numberDefinitions: [],
      nodes: [{ id: rootId, kind: 'root', title: '故事起点', notes: '', effects: [], valueOptions: [], createdAt: nowIso() }],
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

    const seenGroupIds = new Set();
    const seenGroupNames = new Set();
    const numberGroups = (Array.isArray(raw.numberGroups) ? raw.numberGroups : []).map((item, index) => {
      let id = String(item?.id || uid('number-group'));
      while (seenGroupIds.has(id)) id = uid('number-group');
      seenGroupIds.add(id);
      const baseName = String(item?.name || `数值分组 ${index + 1}`).trim() || `数值分组 ${index + 1}`;
      let name = baseName;
      let suffix = 2;
      while (seenGroupNames.has(name)) name = `${baseName}${suffix++}`;
      seenGroupNames.add(name);
      return { id, name, collapsed: Boolean(item?.collapsed) };
    });
    const numberGroupIds = new Set(numberGroups.map(item => item.id));
    const definitions = Array.isArray(raw.numberDefinitions)
      ? raw.numberDefinitions.map(item => ({
        id: String(item.id || uid('number')),
        name: String(item.name || '未命名数值').trim() || '未命名数值',
        initialValue: finiteNumber(item.initialValue),
        groupId: numberGroupIds.has(String(item.groupId || '')) ? String(item.groupId) : ''
      }))
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
        route: normalizeLineRoute(item.route),
        createdAt: String(item.createdAt || nowIso())
      }));

    const viewSettings = normalizeViewSettings(raw.viewSettings);
    viewSettings.nodeOffsets = Object.fromEntries(Object.entries(viewSettings.nodeOffsets)
      .filter(([nodeId]) => nodeIds.has(nodeId)));
    const normalized = {
      schema: SCHEMA,
      formatVersion: 3,
      meta: {
        title: String(raw.meta?.title || '未命名文游'),
        createdAt: String(raw.meta?.createdAt || nowIso()),
        updatedAt: String(raw.meta?.updatedAt || nowIso())
      },
      rootId, viewSettings, numberGroups, numberDefinitions: definitions, nodes, branchLines
    };
    if (topologicalOrder(normalized).hasCycle) throw new Error('导入失败：剧情图中存在循环连接。');
    return normalized;
  }

  function getNode(project, id) { return project.nodes.find(item => item.id === id); }
  function getLine(project, id) { return project.branchLines.find(item => item.id === id); }
  function getDefinition(project, id) { return project.numberDefinitions.find(item => item.id === id); }
  function getNumberGroup(project, id) { return (project.numberGroups || []).find(item => item.id === id); }

  function numberDefinitionSections(project, includeEmpty = false) {
    const groups = Array.isArray(project.numberGroups) ? project.numberGroups : [];
    const knownGroupIds = new Set(groups.map(group => group.id));
    const ungrouped = project.numberDefinitions.filter(definition => !definition.groupId || !knownGroupIds.has(definition.groupId));
    const sections = [{ id: '', name: '未分组', collapsed: false, definitions: ungrouped }];
    groups.forEach(group => sections.push({
      id: group.id,
      name: group.name,
      collapsed: Boolean(group.collapsed),
      definitions: project.numberDefinitions.filter(definition => definition.groupId === group.id)
    }));
    return includeEmpty ? sections : sections.filter(section => section.definitions.length);
  }

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

  function insertNodeOnLine(project, lineId, kind = 'story') {
    if (!['story', 'value'].includes(kind)) throw new Error('只能插入剧情节点或数值节点。');
    const line = getLine(project, lineId);
    if (!line) throw new Error('找不到要拆分的分支线。');
    const previousTarget = line.targetId;
    if (!getNode(project, previousTarget)) throw new Error('分支线的目标节点不存在。');
    const node = {
      id: uid('node'), kind,
      title: kind === 'value' ? '数值选择' : '新节点',
      notes: '', effects: [],
      valueOptions: kind === 'value' ? [newValueOption('选项 1')] : [],
      createdAt: nowIso(), sortIndex: project.nodes.length
    };
    const downstreamLine = {
      id: uid('line'), sourceId: node.id, targetId: previousTarget, label: '', effects: [],
      lock: newLock(project.numberDefinitions[0]?.id || ''), route: newLineRoute(), createdAt: nowIso()
    };
    project.nodes.push(node);
    line.targetId = node.id;
    line.route = newLineRoute();
    project.branchLines.push(downstreamLine);
    return { node, upstreamLine: line, downstreamLine };
  }

  function nodeConversionStatus(project, nodeId, targetKind) {
    const node = getNode(project, nodeId);
    if (!node) return { allowed: false, reason: '找不到这个节点。' };
    if (!['story', 'value'].includes(targetKind)) return { allowed: false, reason: '不支持这个节点类型。' };
    if (node.kind === 'root' || node.id === project.rootId) return { allowed: false, reason: '元节点不能转换类型。' };
    if (node.kind === targetKind) return { allowed: false, reason: '节点已经是这个类型。' };
    if (node.kind === 'story' && targetKind === 'value') {
      const outgoingCount = outgoingLines(project, node.id).length;
      if (outgoingCount > 1) {
        return { allowed: false, reason: `该剧情节点有 ${outgoingCount} 条后续分支线。请先将剧情分支整理为至多一条，再转换为数值节点。` };
      }
      return { allowed: true, reason: '名称、备注和连接都会保留，并建立一个默认数值选项。' };
    }
    if (node.kind === 'value' && targetKind === 'story') {
      const options = getValueOptions(node);
      const effectCount = options.reduce((total, option) => total + (option.effects || []).length, 0);
      const isUntouchedDefault = options.length === 1 && options[0].name?.trim() === '选项 1' && effectCount === 0;
      if (options.length && !isUntouchedDefault) {
        const namedCount = options.filter((option, index) => option.name?.trim() !== `选项 ${index + 1}`).length;
        return {
          allowed: false,
          reason: `该数值节点已有 ${options.length} 个选项、${effectCount} 条数值变化${namedCount ? `，其中 ${namedCount} 个选项已命名` : ''}。请先清空为默认选项，避免转换时丢失逻辑。`
        };
      }
      return { allowed: true, reason: '名称、备注和连接都会保留，空的默认数值选项会被移除。' };
    }
    return { allowed: false, reason: '当前节点无法进行这种转换。' };
  }

  function convertNodeKind(project, nodeId, targetKind) {
    const status = nodeConversionStatus(project, nodeId, targetKind);
    if (!status.allowed) throw new Error(status.reason);
    const node = getNode(project, nodeId);
    if (targetKind === 'value') {
      const legacyEffects = Array.isArray(node.effects) ? node.effects : [];
      const option = newValueOption(legacyEffects.length ? '原有数值调整' : '选项 1');
      option.effects = legacyEffects;
      node.kind = 'value';
      node.effects = [];
      node.valueOptions = [option];
    } else {
      node.kind = 'story';
      node.effects = [];
      node.valueOptions = [];
    }
    return node;
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

  function estimateNoteBox(node, viewSettings) {
    if (!viewSettings.notes.enabled || !String(node.notes || '').trim()) return null;
    const width = 240;
    const contentWidth = width - 28;
    const lineCount = String(node.notes).split(/\r?\n/).reduce((total, line) => {
      const estimatedWidth = Array.from(line || ' ').reduce((sum, character) => sum + (/[\u0000-\u00ff]/u.test(character) ? 7.2 : 13), 0);
      return total + Math.max(1, Math.ceil(estimatedWidth / contentWidth));
    }, 0);
    return { width, height: Math.min(240, Math.max(66, 38 + lineCount * 19)) };
  }

  function orderLevels(project, depths, levels, maxDepth) {
    const projectOrder = new Map(project.nodes.map((node, index) => [node.id, finiteNumber(node.sortIndex, index)]));
    levels.forEach(items => items.sort((a, b) => projectOrder.get(a.id) - projectOrder.get(b.id)));
    const relativeOrder = () => {
      const result = new Map();
      levels.forEach(items => items.forEach((node, index) => result.set(node.id, items.length <= 1 ? .5 : index / (items.length - 1))));
      return result;
    };
    const reorder = (depth, neighborLines, neighborId) => {
      const items = levels.get(depth) || [];
      if (items.length < 2) return;
      const previousIndex = new Map(items.map((node, index) => [node.id, index]));
      const relative = relativeOrder();
      const score = node => {
        const neighbors = neighborLines(node.id).map(line => relative.get(neighborId(line))).filter(Number.isFinite);
        return neighbors.length ? neighbors.reduce((sum, value) => sum + value, 0) / neighbors.length : previousIndex.get(node.id);
      };
      items.sort((a, b) => score(a) - score(b) || previousIndex.get(a.id) - previousIndex.get(b.id));
    };
    for (let sweep = 0; sweep < 4; sweep += 1) {
      for (let depth = 1; depth <= maxDepth; depth += 1) reorder(depth, nodeId => incomingLines(project, nodeId), line => line.sourceId);
      for (let depth = maxDepth - 1; depth >= 0; depth -= 1) reorder(depth, nodeId => outgoingLines(project, nodeId), line => line.targetId);
    }
  }

  function layoutGraph(project) {
    const topo = topologicalOrder(project);
    const depths = new Map(project.nodes.map(node => [node.id, 0]));
    topo.order.forEach(nodeId => {
      const depth = depths.get(nodeId) || 0;
      outgoingLines(project, nodeId).forEach(line => depths.set(line.targetId, Math.max(depths.get(line.targetId) || 0, depth + 1)));
    });
    const maxDepth = Math.max(0, ...depths.values());
    const levels = new Map();
    for (let depth = 0; depth <= maxDepth; depth += 1) levels.set(depth, []);
    project.nodes.forEach(node => levels.get(depths.get(node.id) || 0).push(node));
    orderLevels(project, depths, levels, maxDepth);

    const viewSettings = normalizeViewSettings(project.viewSettings);
    const notePosition = viewSettings.notes.position;
    const nodeSizes = new Map(project.nodes.map(node => [node.id, {
      width: node.kind === 'value' ? 204 : 220,
      height: node.kind === 'value' ? 104 : 108
    }]));
    const noteMetrics = new Map(project.nodes.map(node => [node.id, estimateNoteBox(node, viewSettings)]));
    const footprints = new Map();
    project.nodes.forEach(node => {
      const size = nodeSizes.get(node.id);
      const note = noteMetrics.get(node.id);
      let above = 0;
      let below = 0;
      let left = 0;
      let right = 0;
      if (note) {
        if (notePosition === 'top') above = note.height + 18;
        if (notePosition === 'bottom') below = note.height + 18;
        if (notePosition === 'left') {
          left = note.width + 26;
          above = below = Math.max(0, (note.height - size.height) / 2);
        }
        if (notePosition === 'right') {
          right = note.width + 26;
          above = below = Math.max(0, (note.height - size.height) / 2);
        }
        if (notePosition === 'top' || notePosition === 'bottom') {
          const horizontalOverflow = Math.max(0, (note.width - size.width) / 2);
          left = right = horizontalOverflow;
        }
      }
      footprints.set(node.id, { above, below, left, right, height: above + size.height + below });
    });

    const verticalGap = 38;
    const levelHeights = new Map();
    levels.forEach((items, depth) => levelHeights.set(depth, items.reduce((total, node) => total + footprints.get(node.id).height, 0) + Math.max(0, items.length - 1) * verticalGap));
    const manualBottom = Math.max(0, ...project.branchLines.flatMap(line => (line.route?.points || []).map(point => finiteNumber(point.y))));
    const automaticWorldHeight = Math.max(700, ...levelHeights.values(), manualBottom + 90) + 150;

    const columnLeft = new Map();
    const columnRight = new Map();
    for (let depth = 0; depth <= maxDepth; depth += 1) {
      const items = levels.get(depth) || [];
      columnLeft.set(depth, Math.max(0, ...items.map(node => footprints.get(node.id).left)));
      columnRight.set(depth, Math.max(220, ...items.map(node => nodeSizes.get(node.id).width + footprints.get(node.id).right)));
    }
    const columnX = new Map([[0, 70 + (columnLeft.get(0) || 0)]]);
    for (let depth = 1; depth <= maxDepth; depth += 1) {
      const previousVisualRight = (columnX.get(depth - 1) || 70) + (columnRight.get(depth - 1) || 220);
      let nextX = previousVisualRight + 126 + (columnLeft.get(depth) || 0);
      project.branchLines.forEach(line => {
        const targetDepth = depths.get(line.targetId) || 0;
        const sourceDepth = depths.get(line.sourceId) || 0;
        if (targetDepth !== depth || sourceDepth >= targetDepth || !columnX.has(sourceDepth)) return;
        const sourceVisualRight = columnX.get(sourceDepth) + (columnRight.get(sourceDepth) || nodeSizes.get(line.sourceId)?.width || 220);
        const requiredGap = Math.max(126, edgeLabelWidth(line.label) + 56);
        nextX = Math.max(nextX, sourceVisualRight + requiredGap + (columnLeft.get(depth) || 0));
      });
      columnX.set(depth, nextX);
    }

    const positions = new Map();
    const basePositions = new Map();
    const noteBoxes = new Map();
    const obstacles = [];
    for (let depth = 0; depth <= maxDepth; depth += 1) {
      const items = levels.get(depth) || [];
      let cursorY = (automaticWorldHeight - (levelHeights.get(depth) || 0)) / 2;
      items.forEach(node => {
        const size = nodeSizes.get(node.id);
        const footprint = footprints.get(node.id);
        const baseX = columnX.get(depth) || 70;
        const baseY = cursorY + footprint.above;
        const offset = viewSettings.nodeOffsets[node.id] || { x: 0, y: 0 };
        const x = Math.max(24 + footprint.left, baseX + offset.x);
        const y = Math.max(24 + footprint.above, baseY + offset.y);
        basePositions.set(node.id, { x: baseX, y: baseY, width: size.width, height: size.height, depth });
        const position = { x, y, width: size.width, height: size.height, depth };
        positions.set(node.id, position);
        obstacles.push({ type: 'node', ownerId: node.id, x, y, width: size.width, height: size.height });
        const note = noteMetrics.get(node.id);
        if (note) {
          let noteX = x + size.width + 26;
          let noteY = y + (size.height - note.height) / 2;
          if (notePosition === 'left') noteX = x - note.width - 26;
          if (notePosition === 'top') { noteX = x + (size.width - note.width) / 2; noteY = y - note.height - 18; }
          if (notePosition === 'bottom') { noteX = x + (size.width - note.width) / 2; noteY = y + size.height + 18; }
          const noteBox = { x: noteX, y: noteY, width: note.width, height: note.height, position: notePosition };
          noteBoxes.set(node.id, noteBox);
          obstacles.push({ type: 'note', ownerId: node.id, ...noteBox });
        }
        cursorY += footprint.height + verticalGap;
      });
    }
    const manualRight = Math.max(0, ...project.branchLines.flatMap(line => (line.route?.points || []).map(point => finiteNumber(point.x))));
    const rightEdge = Math.max(0, manualRight, ...obstacles.map(item => item.x + item.width));
    const bottomEdge = Math.max(0, manualBottom, ...obstacles.map(item => item.y + item.height));
    const worldWidth = Math.max(980, rightEdge + 270);
    const worldHeight = Math.max(automaticWorldHeight, bottomEdge + 150);
    return { positions, basePositions, noteBoxes, obstacles, width: worldWidth, height: worldHeight, depths, columnX, levels };
  }

  function compressRoutePoints(points) {
    const compact = [];
    points.forEach(point => {
      const normalized = { x: finiteNumber(point.x), y: finiteNumber(point.y) };
      const previous = compact.at(-1);
      if (!previous || Math.hypot(previous.x - normalized.x, previous.y - normalized.y) > .5) compact.push(normalized);
    });
    for (let index = compact.length - 2; index > 0; index -= 1) {
      const before = compact[index - 1];
      const current = compact[index];
      const after = compact[index + 1];
      const vertical = Math.abs(before.x - current.x) < .5 && Math.abs(current.x - after.x) < .5;
      const horizontal = Math.abs(before.y - current.y) < .5 && Math.abs(current.y - after.y) < .5;
      if (vertical || horizontal) compact.splice(index, 1);
    }
    return compact;
  }

  function roundedRoutePath(points, radius = 11) {
    if (!points.length) return '';
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
    let path = `M ${points[0].x} ${points[0].y}`;
    for (let index = 1; index < points.length - 1; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      const next = points[index + 1];
      const incomingLength = Math.hypot(current.x - previous.x, current.y - previous.y);
      const outgoingLength = Math.hypot(next.x - current.x, next.y - current.y);
      const corner = Math.min(radius, incomingLength / 2, outgoingLength / 2);
      if (corner < .5) {
        path += ` L ${current.x} ${current.y}`;
        continue;
      }
      const before = {
        x: current.x - (current.x - previous.x) / incomingLength * corner,
        y: current.y - (current.y - previous.y) / incomingLength * corner
      };
      const after = {
        x: current.x + (next.x - current.x) / outgoingLength * corner,
        y: current.y + (next.y - current.y) / outgoingLength * corner
      };
      path += ` L ${before.x} ${before.y} Q ${current.x} ${current.y} ${after.x} ${after.y}`;
    }
    const last = points.at(-1);
    return `${path} L ${last.x} ${last.y}`;
  }

  function routeSegments(points) {
    return points.slice(0, -1).map((point, index) => ({ a: point, b: points[index + 1] }));
  }

  function segmentLength(segment) {
    return Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y);
  }

  function segmentIntersectsRect(segment, rect) {
    const minX = Math.min(segment.a.x, segment.b.x);
    const maxX = Math.max(segment.a.x, segment.b.x);
    const minY = Math.min(segment.a.y, segment.b.y);
    const maxY = Math.max(segment.a.y, segment.b.y);
    if (maxX < rect.x || minX > rect.x + rect.width || maxY < rect.y || minY > rect.y + rect.height) return false;
    if (Math.abs(segment.a.y - segment.b.y) < .5) return segment.a.y >= rect.y && segment.a.y <= rect.y + rect.height;
    if (Math.abs(segment.a.x - segment.b.x) < .5) return segment.a.x >= rect.x && segment.a.x <= rect.x + rect.width;
    const steps = Math.max(2, Math.ceil(segmentLength(segment) / 12));
    for (let step = 0; step <= steps; step += 1) {
      const ratio = step / steps;
      const x = segment.a.x + (segment.b.x - segment.a.x) * ratio;
      const y = segment.a.y + (segment.b.y - segment.a.y) * ratio;
      if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) return true;
    }
    return false;
  }

  function routeCongestionPenalty(points, routedPoints) {
    let penalty = 0;
    const segments = routeSegments(points);
    routedPoints.forEach(existingPoints => routeSegments(existingPoints).forEach(existing => segments.forEach(segment => {
      const horizontal = Math.abs(segment.a.y - segment.b.y) < .5;
      const existingHorizontal = Math.abs(existing.a.y - existing.b.y) < .5;
      if (horizontal && existingHorizontal && Math.abs(segment.a.y - existing.a.y) < 13) {
        const overlap = Math.min(Math.max(segment.a.x, segment.b.x), Math.max(existing.a.x, existing.b.x))
          - Math.max(Math.min(segment.a.x, segment.b.x), Math.min(existing.a.x, existing.b.x));
        if (overlap > 12) penalty += 18000 + overlap * 80;
      } else if (!horizontal && !existingHorizontal && Math.abs(segment.a.x - existing.a.x) < 13) {
        const overlap = Math.min(Math.max(segment.a.y, segment.b.y), Math.max(existing.a.y, existing.b.y))
          - Math.max(Math.min(segment.a.y, segment.b.y), Math.min(existing.a.y, existing.b.y));
        if (overlap > 12) penalty += 14000 + overlap * 70;
      } else if (horizontal !== existingHorizontal) {
        const h = horizontal ? segment : existing;
        const v = horizontal ? existing : segment;
        const crosses = v.a.x >= Math.min(h.a.x, h.b.x) && v.a.x <= Math.max(h.a.x, h.b.x)
          && h.a.y >= Math.min(v.a.y, v.b.y) && h.a.y <= Math.max(v.a.y, v.b.y);
        if (crosses) penalty += 2600;
      }
    })));
    return penalty;
  }

  function routeAnchor(points) {
    const segments = routeSegments(points);
    const horizontal = segments.filter(segment => Math.abs(segment.a.y - segment.b.y) < .5);
    const candidates = horizontal.length ? horizontal : segments;
    const best = candidates.sort((a, b) => segmentLength(b) - segmentLength(a))[0] || { a: points[0], b: points.at(-1) };
    return { x: (best.a.x + best.b.x) / 2, y: (best.a.y + best.b.y) / 2 };
  }

  function distributeLinePorts(project, layout) {
    const outgoingPorts = new Map();
    const incomingPorts = new Map();
    project.nodes.forEach(node => {
      const position = layout.positions.get(node.id);
      if (!position) return;
      const assign = (lines, ports, neighborId) => {
        lines.sort((a, b) => {
          const first = layout.positions.get(neighborId(a));
          const second = layout.positions.get(neighborId(b));
          return (first?.y || 0) + (first?.height || 0) / 2 - ((second?.y || 0) + (second?.height || 0) / 2);
        });
        const span = Math.min(Math.max(0, position.height - 30), Math.max(0, lines.length - 1) * 15);
        lines.forEach((line, index) => ports.set(line.id, position.y + position.height / 2 + (lines.length <= 1 ? 0 : -span / 2 + span * index / (lines.length - 1))));
      };
      assign(outgoingLines(project, node.id), outgoingPorts, line => line.targetId);
      assign(incomingLines(project, node.id), incomingPorts, line => line.sourceId);
    });
    return { outgoingPorts, incomingPorts };
  }

  function autoRoutePoints(project, layout, line, start, end, routedPoints) {
    const horizontalGap = Math.max(36, end.x - start.x);
    const lead = Math.min(28, Math.max(16, horizontalGap * .12));
    const sourceNote = layout.noteBoxes?.get(line.sourceId);
    const targetNote = layout.noteBoxes?.get(line.targetId);
    const startLead = { x: start.x + (sourceNote?.position === 'right' ? 10 : lead), y: start.y };
    const endLead = { x: end.x - (targetNote?.position === 'left' ? 10 : lead), y: end.y };
    const relevantObstacles = layout.obstacles.filter(obstacle => {
      if (obstacle.type === 'node' && [line.sourceId, line.targetId].includes(obstacle.ownerId)) return false;
      return obstacle.x + obstacle.width >= startLead.x && obstacle.x <= endLead.x;
    }).map(obstacle => ({
      x: obstacle.x - 14, y: obstacle.y - 14, width: obstacle.width + 28, height: obstacle.height + 28
    }));
    const middle = (start.y + end.y) / 2;
    const laneCandidates = [start.y, end.y, middle];
    for (let offset = 1; offset <= 7; offset += 1) laneCandidates.push(middle - offset * 28, middle + offset * 28);
    relevantObstacles.forEach(obstacle => laneCandidates.push(obstacle.y - 10, obstacle.y + obstacle.height + 10));
    laneCandidates.push(32, layout.height - 32);
    const seen = new Set();
    const candidates = laneCandidates
      .map(value => Math.max(24, Math.min(layout.height - 24, Math.round(value))))
      .filter(value => !seen.has(value) && seen.add(value));
    let best = null;
    candidates.forEach(laneY => {
      const points = compressRoutePoints([
        start, startLead, { x: startLead.x, y: laneY }, { x: endLead.x, y: laneY }, endLead, end
      ]);
      const segments = routeSegments(points);
      const intersections = relevantObstacles.reduce((count, obstacle) => count + segments.filter(segment => segmentIntersectsRect(segment, obstacle)).length, 0);
      const length = segments.reduce((total, segment) => total + segmentLength(segment), 0);
      const distancePenalty = Math.abs(laneY - middle) * .6;
      const score = intersections * 1000000 + routeCongestionPenalty(points, routedPoints) + length + distancePenalty + Math.max(0, points.length - 2) * 14;
      if (!best || score < best.score) best = { points, score };
    });
    return best?.points || compressRoutePoints([start, startLead, endLead, end]);
  }

  function routeBranchLines(project, layout) {
    const routes = new Map();
    const routedPoints = [];
    const { outgoingPorts, incomingPorts } = distributeLinePorts(project, layout);
    const lines = [...project.branchLines].sort((a, b) => {
      const sourceA = layout.positions.get(a.sourceId);
      const sourceB = layout.positions.get(b.sourceId);
      const targetA = layout.positions.get(a.targetId);
      const targetB = layout.positions.get(b.targetId);
      return (sourceA?.depth || 0) - (sourceB?.depth || 0)
        || (sourceA?.y || 0) - (sourceB?.y || 0)
        || (targetA?.y || 0) - (targetB?.y || 0);
    });
    lines.forEach(line => {
      const source = layout.positions.get(line.sourceId);
      const target = layout.positions.get(line.targetId);
      if (!source || !target) return;
      const start = { x: source.x + source.width, y: outgoingPorts.get(line.id) ?? source.y + source.height / 2 };
      const end = { x: target.x, y: incomingPorts.get(line.id) ?? target.y + target.height / 2 };
      const horizontalGap = Math.max(36, end.x - start.x);
      const lead = Math.min(28, Math.max(16, horizontalGap * .12));
      const sourceNote = layout.noteBoxes?.get(line.sourceId);
      const targetNote = layout.noteBoxes?.get(line.targetId);
      const startLead = sourceNote?.position === 'right' ? 10 : lead;
      const endLead = targetNote?.position === 'left' ? 10 : lead;
      const route = normalizeLineRoute(line.route);
      const points = route.mode === 'manual'
        ? compressRoutePoints([start, { x: start.x + startLead, y: start.y }, ...route.points, { x: end.x - endLead, y: end.y }, end])
        : autoRoutePoints(project, layout, line, start, end, routedPoints);
      const anchor = routeAnchor(points);
      const geometry = {
        points,
        d: roundedRoutePath(points),
        startX: start.x, startY: start.y, endX: end.x, endY: end.y,
        labelX: anchor.x, labelY: anchor.y,
        deleteX: anchor.x, deleteY: anchor.y + 21,
        seedPoints: route.mode === 'auto' ? points.slice(1, -1).map(point => ({ ...point })) : route.points.map(point => ({ ...point }))
      };
      routes.set(line.id, geometry);
      routedPoints.push(points);
    });
    return routes;
  }

  function pointToSegmentDistance(point, segment) {
    const dx = segment.b.x - segment.a.x;
    const dy = segment.b.y - segment.a.y;
    const lengthSquared = dx * dx + dy * dy;
    if (!lengthSquared) return Math.hypot(point.x - segment.a.x, point.y - segment.a.y);
    const ratio = Math.max(0, Math.min(1, ((point.x - segment.a.x) * dx + (point.y - segment.a.y) * dy) / lengthSquared));
    return Math.hypot(point.x - (segment.a.x + ratio * dx), point.y - (segment.a.y + ratio * dy));
  }

  function segmentsIntersect(first, second) {
    const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const d1 = cross(first.a, first.b, second.a);
    const d2 = cross(first.a, first.b, second.b);
    const d3 = cross(second.a, second.b, first.a);
    const d4 = cross(second.a, second.b, first.b);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    const onSegment = (point, segment) => Math.abs(cross(segment.a, segment.b, point)) < .01
      && point.x >= Math.min(segment.a.x, segment.b.x) - .01 && point.x <= Math.max(segment.a.x, segment.b.x) + .01
      && point.y >= Math.min(segment.a.y, segment.b.y) - .01 && point.y <= Math.max(segment.a.y, segment.b.y) + .01;
    return onSegment(second.a, first) || onSegment(second.b, first) || onSegment(first.a, second) || onSegment(first.b, second);
  }

  function segmentsVisuallyConflict(first, second, distance = 16) {
    const firstBounds = {
      left: Math.min(first.a.x, first.b.x) - distance,
      right: Math.max(first.a.x, first.b.x) + distance,
      top: Math.min(first.a.y, first.b.y) - distance,
      bottom: Math.max(first.a.y, first.b.y) + distance
    };
    const secondBounds = {
      left: Math.min(second.a.x, second.b.x), right: Math.max(second.a.x, second.b.x),
      top: Math.min(second.a.y, second.b.y), bottom: Math.max(second.a.y, second.b.y)
    };
    if (secondBounds.right < firstBounds.left || secondBounds.left > firstBounds.right || secondBounds.bottom < firstBounds.top || secondBounds.top > firstBounds.bottom) return false;
    if (segmentsIntersect(first, second)) return true;
    return Math.min(
      pointToSegmentDistance(first.a, second), pointToSegmentDistance(first.b, second),
      pointToSegmentDistance(second.a, first), pointToSegmentDistance(second.b, first)
    ) <= distance;
  }

  function assignBranchColorSlots(project, layout, routes, paletteSize = 8) {
    const slotCount = Math.max(1, Math.min(16, Math.floor(finiteNumber(paletteSize, 8))));
    const bundles = new Map();
    project.branchLines.forEach(line => {
      if (!routes.get(line.id)) return;
      if (!bundles.has(line.sourceId)) bundles.set(line.sourceId, []);
      bundles.get(line.sourceId).push(line);
    });
    const sourceIds = [...bundles.keys()];
    const conflicts = new Map(sourceIds.map(sourceId => [sourceId, new Set()]));
    const addConflict = (first, second) => {
      if (first === second) return;
      conflicts.get(first)?.add(second);
      conflicts.get(second)?.add(first);
    };
    for (let firstIndex = 0; firstIndex < sourceIds.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < sourceIds.length; secondIndex += 1) {
        const firstId = sourceIds[firstIndex];
        const secondId = sourceIds[secondIndex];
        const firstLines = bundles.get(firstId);
        const secondLines = bundles.get(secondId);
        const directlyAdjacent = project.branchLines.some(line =>
          (line.sourceId === firstId && line.targetId === secondId) || (line.sourceId === secondId && line.targetId === firstId));
        const sharedTarget = firstLines.some(first => secondLines.some(second => first.targetId === second.targetId));
        const firstPosition = layout.positions.get(firstId);
        const secondPosition = layout.positions.get(secondId);
        const nearbyPeers = firstPosition && secondPosition && firstPosition.depth === secondPosition.depth
          && Math.abs((firstPosition.y + firstPosition.height / 2) - (secondPosition.y + secondPosition.height / 2)) < 190;
        let routeConflict = false;
        for (const first of firstLines) {
          if (routeConflict) break;
          const firstSegments = routeSegments(routes.get(first.id)?.points || []);
          for (const second of secondLines) {
            const secondSegments = routeSegments(routes.get(second.id)?.points || []);
            if (firstSegments.some(segment => secondSegments.some(other => segmentsVisuallyConflict(segment, other)))) {
              routeConflict = true;
              break;
            }
          }
        }
        if (directlyAdjacent || sharedTarget || nearbyPeers || routeConflict) addConflict(firstId, secondId);
      }
    }

    const projectOrder = new Map(project.nodes.map((node, index) => [node.id, index]));
    const ordered = [...sourceIds].sort((first, second) =>
      (conflicts.get(second)?.size || 0) - (conflicts.get(first)?.size || 0)
      || (bundles.get(second)?.length || 0) - (bundles.get(first)?.length || 0)
      || (projectOrder.get(first) || 0) - (projectOrder.get(second) || 0));
    const slots = new Map();
    ordered.forEach(sourceId => {
      const neighborSlots = [...(conflicts.get(sourceId) || [])].map(neighborId => slots.get(neighborId)).filter(Number.isInteger);
      let slot = Array.from({ length: slotCount }, (_, index) => index).find(index => !neighborSlots.includes(index));
      if (!Number.isInteger(slot)) {
        const counts = Array.from({ length: slotCount }, (_, index) => neighborSlots.filter(value => value === index).length);
        slot = counts.indexOf(Math.min(...counts));
      }
      slots.set(sourceId, slot);
    });
    return slots;
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
      formatVersion: 3,
      description: '这是剧情脉络导出的文游有向剧情图。剧情节点表示结构路径；数值节点用 valueOptions 表示互斥选项，这些选项只改变数值并共享同一组后续分支线；branchLines 表示有方向的剧情转移；数值锁应针对每条实际状态逐条判断。数值分组仅用于整理和查找，不改变计算含义。',
      meta: clone(project.meta),
      rootId: project.rootId,
      viewSettings: clone(normalizeViewSettings(project.viewSettings)),
      numberGroups: clone(project.numberGroups || []),
      numberDefinitions: clone(project.numberDefinitions),
      numberDefinitionsReadable: project.numberDefinitions.map(definition => ({
        id: definition.id,
        name: definition.name,
        initialValue: definition.initialValue,
        group: getNumberGroup(project, definition.groupId)?.name || '未分组'
      })),
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
        numberGroups: 'numberGroups 与 numberDefinitions.groupId 只表达数值类的整理层级；未填写 groupId 的数值类属于“未分组”。移动、折叠或重命名分组都不改变任何数值逻辑。',
        visualSettings: 'viewSettings 中的主题、分支分色开关、节点相对自动布局的偏移，以及 branchLines.route 的手动转折点都只控制画布显示，不改变剧情方向、数值变化或数值锁逻辑。',
        convergence: '一个节点拥有多条入分支线时表示收束；computedState.possibleValues 给出全部有效路径汇聚后的理论上下限。',
        xor: '可视化条件组中的 XOR 表示其直接子条件中恰好一个成立。高级表达式中的 XOR/^ 是二元异或。'
      }
    };
  }

  window.StoryModel = {
    SCHEMA, uid, clone, nowIso, finiteNumber, createDefaultProject, normalizeProject,
    newEffect, newValueOption, newNumberGroup, newCondition, newGroup, newLock, newLineRoute, defaultViewSettings, normalizeViewSettings,
    getNode, getLine, getDefinition, getNumberGroup, getValueOptions,
    numberDefinitionSections, outgoingLines, incomingLines, reachableSet, topologicalOrder, wouldCreateCycle,
    insertNodeOnLine, nodeConversionStatus, convertNodeKind,
    calculate, edgeLabelWidth, layoutGraph, routeBranchLines, assignBranchColorSlots, formatNumber, formatRange, effectToText, conditionToText, lockToText,
    countReferences, removeVariableReferences, findLockItem, buildAiExport
  };
})();
