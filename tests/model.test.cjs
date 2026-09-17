const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { webcrypto } = require('node:crypto');

global.window = global;
global.crypto = webcrypto;
const root = path.resolve(__dirname, '..', 'wwwroot');
vm.runInThisContext(fs.readFileSync(path.join(root, 'expression.js'), 'utf8'), { filename: 'expression.js' });
vm.runInThisContext(fs.readFileSync(path.join(root, 'model.js'), 'utf8'), { filename: 'model.js' });

const M = global.StoryModel;

function makeProject() {
  const project = M.createDefaultProject();
  project.numberDefinitions = [
    { id: 'age', name: '年龄', initialValue: 30 },
    { id: 'affection', name: '好感度', initialValue: 0 }
  ];
  return project;
}

function node(id, title, kind = 'story', effects = []) {
  return { id, kind, title, notes: '', effects, createdAt: M.nowIso() };
}

function line(id, sourceId, targetId, effects = [], lock = M.newLock('age')) {
  return { id, sourceId, targetId, label: id, effects, lock, createdAt: M.nowIso() };
}

function effect(variableId, operator, operandValue) {
  return { id: M.uid('effect'), variableId, operator, operandType: 'number', operandValue, operandVariableId: '' };
}

function valueOption(name, effects = []) {
  const option = M.newValueOption(name);
  option.effects = effects;
  return option;
}

{
  const p = makeProject();
  p.nodes.push(node('b', 'B'));
  p.branchLines.push(line('root-b', p.rootId, 'b', [effect('age', 'add', 5)]));
  const result = M.calculate(p).nodeResults.get('b');
  assert.equal(result.values.age.min, 35);
  assert.equal(result.values.age.max, 35);
}

{
  const p = makeProject();
  p.nodes.push(node('b', 'B'), node('c', 'C'), node('e', 'E'), node('f', 'F'));
  p.branchLines.push(
    line('root-b', p.rootId, 'b', [effect('age', 'add', 5)]),
    line('root-c', p.rootId, 'c', [effect('age', 'subtract', 5)]),
    line('b-e', 'b', 'e'),
    line('c-e', 'c', 'e')
  );
  const gate = M.newLock('age');
  gate.enabled = true;
  gate.builder.children[0].comparator = '>=';
  gate.builder.children[0].rightValue = 30;
  p.branchLines.push(line('e-f', 'e', 'f', [], gate));
  const calculation = M.calculate(p);
  assert.deepEqual(
    [calculation.nodeResults.get('e').values.age.min, calculation.nodeResults.get('e').values.age.max],
    [25, 35]
  );
  assert.deepEqual(
    [calculation.nodeResults.get('f').values.age.min, calculation.nodeResults.get('f').values.age.max],
    [35, 35]
  );
  assert.equal(calculation.edgeStats.get('e-f').passed, 1);
  assert.equal(calculation.edgeStats.get('e-f').blocked, 1);
}

{
  const p = makeProject();
  p.nodes.push(node('xor-pass', '异或通过'), node('xor-block', '异或阻断'));
  const passLock = M.newLock('age');
  passLock.enabled = true;
  passLock.builder.operator = 'XOR';
  passLock.builder.children = [
    { ...M.newCondition('age'), comparator: '>=', rightValue: 30 },
    { ...M.newCondition('affection'), comparator: '>=', rightValue: 1 }
  ];
  const blockLock = M.clone(passLock);
  blockLock.builder.id = M.uid('group');
  blockLock.builder.children[1].rightValue = 0;
  p.branchLines.push(line('xor-pass-line', p.rootId, 'xor-pass', [], passLock));
  p.branchLines.push(line('xor-block-line', p.rootId, 'xor-block', [], blockLock));
  const calculation = M.calculate(p);
  assert.equal(calculation.nodeResults.get('xor-pass').reachable, true);
  assert.equal(calculation.nodeResults.get('xor-block').reachable, false);
}

{
  const p = makeProject();
  p.nodes.push(node('advanced', '高级表达式'));
  const lock = M.newLock('age');
  lock.enabled = true;
  lock.mode = 'advanced';
  lock.expression = '([年龄] >= 30 && [好感度] == 0) XOR [年龄] < 20';
  p.branchLines.push(line('advanced-line', p.rootId, 'advanced', [], lock));
  assert.equal(M.calculate(p).nodeResults.get('advanced').reachable, true);
}

{
  const p = makeProject();
  p.nodes.push(node('value-node', '数值节点', 'value', [effect('age', 'add', 1)]), node('target', '目标'));
  const lock = M.newLock('age');
  lock.enabled = true;
  p.branchLines.push(line('to-value', p.rootId, 'value-node'));
  p.branchLines.push(line('to-target', 'value-node', 'target', [effect('age', 'subtract', 2)], lock));
  const refs = M.countReferences(p, 'age');
  assert.equal(refs.nodeCount, 1);
  assert.equal(refs.lineCount, 1);
  M.removeVariableReferences(p, 'age', '年龄');
  assert.equal(p.nodes.find(item => item.id === 'value-node').effects.length, 0);
  assert.equal(p.branchLines.find(item => item.id === 'to-target').effects.length, 0);
}

{
  const p = makeProject();
  const choice = node('choice', '休息方式', 'value');
  choice.valueOptions = [
    valueOption('睡一觉', [effect('age', 'add', 5), effect('affection', 'add', 2)]),
    valueOption('继续赶路', [effect('age', 'subtract', 10)])
  ];
  p.nodes.push(choice, node('after-choice', '共同后续'));
  p.branchLines.push(line('to-choice', p.rootId, 'choice'), line('choice-next', 'choice', 'after-choice'));
  const calculation = M.calculate(p);
  const atChoice = calculation.nodeResults.get('choice');
  const afterChoice = calculation.nodeResults.get('after-choice');
  assert.deepEqual([atChoice.values.age.min, atChoice.values.age.max], [20, 35]);
  assert.deepEqual([afterChoice.values.age.min, afterChoice.values.age.max], [20, 35]);
  assert.deepEqual([afterChoice.values.affection.min, afterChoice.values.affection.max], [0, 2]);
  assert.equal(atChoice.pathCount, 2);
  assert.equal(afterChoice.pathCount, 2);
}

{
  const p = makeProject();
  const choice = node('choice', '两种结果', 'value');
  choice.valueOptions = [
    valueOption('满足门槛', [effect('age', 'add', 5)]),
    valueOption('不满足门槛', [effect('age', 'subtract', 10)])
  ];
  p.nodes.push(choice, node('locked-target', '锁后节点'));
  p.branchLines.push(line('to-choice', p.rootId, 'choice'));
  const lock = M.newLock('age');
  lock.enabled = true;
  lock.builder.children[0].comparator = '>=';
  lock.builder.children[0].rightValue = 30;
  p.branchLines.push(line('choice-lock', 'choice', 'locked-target', [], lock));
  const calculation = M.calculate(p);
  const target = calculation.nodeResults.get('locked-target');
  assert.deepEqual([target.values.age.min, target.values.age.max], [35, 35]);
  assert.equal(calculation.edgeStats.get('choice-lock').evaluated, 2);
  assert.equal(calculation.edgeStats.get('choice-lock').passed, 1);
  assert.equal(calculation.edgeStats.get('choice-lock').blocked, 1);
}

{
  const p = makeProject();
  const choice = node('empty-choice', '尚未配置', 'value');
  choice.valueOptions = [];
  p.nodes.push(choice, node('after-empty', '空选项后续'));
  p.branchLines.push(line('to-empty', p.rootId, 'empty-choice'), line('empty-next', 'empty-choice', 'after-empty'));
  const calculation = M.calculate(p);
  assert.equal(calculation.nodeResults.get('empty-choice').values.age.min, 30);
  assert.equal(calculation.nodeResults.get('after-empty').values.age.max, 30);
  assert.equal(calculation.nodeResults.get('after-empty').pathCount, 1);
}

{
  const p = makeProject();
  const choice = node('same-choice', '同值选项', 'value');
  choice.valueOptions = [valueOption('选项甲'), valueOption('选项乙')];
  p.nodes.push(choice);
  p.branchLines.push(line('to-same', p.rootId, 'same-choice'));
  const result = M.calculate(p).nodeResults.get('same-choice');
  assert.equal(result.possibleStateCount, 1);
  assert.equal(result.pathCount, 2);
  assert.equal(result.values.age.min, 30);
}

{
  const p = makeProject();
  const choice = node('partly-invalid', '部分无效', 'value');
  choice.valueOptions = [
    valueOption('有效选项', [effect('age', 'add', 3)]),
    valueOption('除零选项', [effect('age', 'divide', 0)])
  ];
  p.nodes.push(choice);
  p.branchLines.push(line('to-partly-invalid', p.rootId, 'partly-invalid'));
  const calculation = M.calculate(p);
  assert.equal(calculation.nodeResults.get('partly-invalid').reachable, true);
  assert.equal(calculation.nodeResults.get('partly-invalid').values.age.min, 33);
  assert.ok(calculation.errors.some(message => message.includes('除零选项') && message.includes('除以 0')));
}

{
  const p = makeProject();
  const legacy = node('legacy-value', '旧数值节点', 'value', [effect('age', 'add', 4)]);
  p.nodes.push(legacy);
  p.branchLines.push(line('to-legacy', p.rootId, 'legacy-value'));
  const normalized = M.normalizeProject(p);
  const migrated = normalized.nodes.find(item => item.id === 'legacy-value');
  assert.equal(normalized.formatVersion, 3);
  assert.equal(migrated.effects.length, 0);
  assert.equal(migrated.valueOptions.length, 1);
  assert.equal(migrated.valueOptions[0].name, '原有数值调整');
  assert.equal(M.calculate(normalized).nodeResults.get('legacy-value').values.age.min, 34);
}

{
  const p = makeProject();
  const choice = node('reference-choice', '引用测试', 'value');
  choice.valueOptions = [
    valueOption('增加年龄', [effect('age', 'add', 1)]),
    valueOption('年龄乘好感度', [{ ...effect('age', 'multiply', 0), operandType: 'variable', operandVariableId: 'affection' }])
  ];
  p.nodes.push(choice);
  p.branchLines.push(line('to-reference', p.rootId, 'reference-choice'));
  const references = M.countReferences(p, 'age');
  assert.equal(references.nodeCount, 1);
  M.removeVariableReferences(p, 'age', '年龄');
  assert.equal(choice.valueOptions[0].effects.length, 0);
  assert.equal(choice.valueOptions[1].effects.length, 0);
}

{
  const p = makeProject();
  const choice = node('export-choice', '导出选项', 'value');
  choice.valueOptions = [valueOption('买药', [effect('affection', 'add', 5)]), valueOption('离开')];
  p.nodes.push(choice);
  p.branchLines.push(line('to-export-choice', p.rootId, 'export-choice'));
  const exported = M.buildAiExport(p);
  const exportedChoice = exported.nodes.find(item => item.id === 'export-choice');
  assert.equal(exported.formatVersion, 3);
  assert.equal(exportedChoice.valueOptionsReadable[0].name, '买药');
  assert.equal(exportedChoice.valueOptionsReadable[0].numericChanges[0], '好感度 + 5');
  assert.match(exported.aiReadingGuide.valueNodeChoices, /互斥/);
  const imported = M.normalizeProject(exported);
  assert.equal(imported.nodes.find(item => item.id === 'export-choice').valueOptions.length, 2);
}

{
  const p = makeProject();
  p.nodes.push(node('b', 'B'), node('c', 'C'));
  p.branchLines.push(line('root-b', p.rootId, 'b'), line('b-c', 'b', 'c'));
  assert.equal(M.wouldCreateCycle(p, 'c', 'b'), true);
  assert.equal(M.wouldCreateCycle(p, 'b', 'c'), false);
  const exported = M.buildAiExport(p);
  const imported = M.normalizeProject(exported);
  assert.equal(imported.nodes.length, p.nodes.length);
  assert.equal(imported.branchLines.length, p.branchLines.length);
  assert.equal(imported.numberDefinitions[0].name, '年龄');
}

{
  const p = makeProject();
  const target = node('insert-target', '原终点');
  p.nodes.push(target);
  const originalLock = M.newLock('age');
  originalLock.enabled = true;
  originalLock.builder.children[0].rightValue = 20;
  const original = line('insert-line', p.rootId, target.id, [effect('age', 'add', 5)], originalLock);
  original.label = '保留原规则';
  p.branchLines.push(original);
  const inserted = M.insertNodeOnLine(p, original.id, 'story');
  assert.equal(inserted.node.kind, 'story');
  assert.equal(original.targetId, inserted.node.id);
  assert.equal(original.label, '保留原规则');
  assert.equal(original.effects.length, 1);
  assert.equal(original.lock.enabled, true);
  assert.equal(inserted.downstreamLine.sourceId, inserted.node.id);
  assert.equal(inserted.downstreamLine.targetId, target.id);
  assert.equal(inserted.downstreamLine.label, '');
  assert.equal(inserted.downstreamLine.effects.length, 0);
  assert.equal(M.calculate(p).nodeResults.get(target.id).values.age.min, 35);
}

{
  const p = makeProject();
  p.nodes.push(node('value-insert-target', '数值插入终点'));
  p.branchLines.push(line('value-insert-line', p.rootId, 'value-insert-target'));
  const inserted = M.insertNodeOnLine(p, 'value-insert-line', 'value');
  assert.equal(inserted.node.kind, 'value');
  assert.equal(inserted.node.valueOptions.length, 1);
  assert.equal(inserted.node.valueOptions[0].name, '选项 1');
  assert.equal(M.calculate(p).nodeResults.get('value-insert-target').values.age.min, 30);
}

{
  const p = makeProject();
  const convertible = node('convertible-story', '可转换剧情', 'story', [effect('age', 'add', 4)]);
  p.nodes.push(convertible, node('convert-target', '转换后续'));
  p.branchLines.push(line('to-convertible', p.rootId, convertible.id), line('convert-out', convertible.id, 'convert-target'));
  const before = M.calculate(p).nodeResults.get('convert-target').values.age.min;
  assert.equal(M.nodeConversionStatus(p, convertible.id, 'value').allowed, true);
  M.convertNodeKind(p, convertible.id, 'value');
  assert.equal(convertible.kind, 'value');
  assert.equal(convertible.effects.length, 0);
  assert.equal(convertible.valueOptions[0].name, '原有数值调整');
  assert.equal(M.calculate(p).nodeResults.get('convert-target').values.age.min, before);
}

{
  const p = makeProject();
  const branching = node('branching-story', '有分支剧情');
  p.nodes.push(branching, node('branch-a', 'A'), node('branch-b', 'B'));
  p.branchLines.push(line('to-branching', p.rootId, branching.id), line('branch-a-line', branching.id, 'branch-a'), line('branch-b-line', branching.id, 'branch-b'));
  const status = M.nodeConversionStatus(p, branching.id, 'value');
  assert.equal(status.allowed, false);
  assert.match(status.reason, /2 条后续分支线/);
  assert.throws(() => M.convertNodeKind(p, branching.id, 'value'), /请先将剧情分支整理/);
}

{
  const p = makeProject();
  const emptyValue = node('empty-value-convert', '空数值节点', 'value');
  emptyValue.valueOptions = [valueOption('选项 1')];
  const renamedValue = node('renamed-value-convert', '已命名数值节点', 'value');
  renamedValue.valueOptions = [valueOption('休息')];
  const configuredValue = node('configured-value-convert', '已配置数值节点', 'value');
  configuredValue.valueOptions = [valueOption('休息', [effect('age', 'add', 1)]), valueOption('赶路')];
  p.nodes.push(emptyValue, renamedValue, configuredValue);
  assert.equal(M.nodeConversionStatus(p, emptyValue.id, 'story').allowed, true);
  M.convertNodeKind(p, emptyValue.id, 'story');
  assert.equal(emptyValue.kind, 'story');
  assert.deepEqual(emptyValue.valueOptions, []);
  const renamedBlocked = M.nodeConversionStatus(p, renamedValue.id, 'story');
  assert.equal(renamedBlocked.allowed, false);
  assert.match(renamedBlocked.reason, /1 个选项已命名/);
  const blocked = M.nodeConversionStatus(p, configuredValue.id, 'story');
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reason, /2 个选项/);
}

{
  const p = makeProject();
  p.numberGroups = [
    { id: 'character', name: '角色属性', collapsed: false },
    { id: 'story-state', name: '剧情状态', collapsed: true }
  ];
  p.numberDefinitions[0].groupId = 'character';
  p.numberDefinitions[1].groupId = 'missing-group';
  const normalized = M.normalizeProject(p);
  assert.equal(normalized.formatVersion, 3);
  assert.equal(normalized.numberGroups.length, 2);
  assert.equal(normalized.numberGroups[1].collapsed, true);
  assert.equal(normalized.numberDefinitions.find(item => item.id === 'age').groupId, 'character');
  assert.equal(normalized.numberDefinitions.find(item => item.id === 'affection').groupId, '');
  const sections = M.numberDefinitionSections(normalized);
  assert.deepEqual(sections.map(section => section.name), ['未分组', '角色属性']);
  const exported = M.buildAiExport(normalized);
  assert.equal(exported.numberDefinitionsReadable.find(item => item.id === 'age').group, '角色属性');
  assert.equal(exported.numberDefinitionsReadable.find(item => item.id === 'affection').group, '未分组');
  assert.match(exported.aiReadingGuide.numberGroups, /不改变任何数值逻辑/);
}

{
  const legacy = makeProject();
  delete legacy.numberGroups;
  legacy.formatVersion = 2;
  legacy.schema = 'storyweaver.project.v2';
  const normalized = M.normalizeProject(legacy);
  assert.equal(normalized.formatVersion, 3);
  assert.deepEqual(normalized.numberGroups, []);
  assert.ok(normalized.numberDefinitions.every(definition => definition.groupId === ''));
}

{
  const p = makeProject();
  p.nodes.push(node('short-target', '短分支目标'));
  const branch = line('adaptive-line', p.rootId, 'short-target');
  branch.label = '短名称';
  p.branchLines.push(branch);
  const shortLayout = M.layoutGraph(p);
  const shortSource = shortLayout.positions.get(p.rootId);
  const shortTarget = shortLayout.positions.get('short-target');
  const shortGap = shortTarget.x - shortSource.x - shortSource.width;

  branch.label = '这是一条需要完整展示而且会让分支线自动延长的剧情选择名称';
  const longLayout = M.layoutGraph(p);
  const longSource = longLayout.positions.get(p.rootId);
  const longTarget = longLayout.positions.get('short-target');
  const longGap = longTarget.x - longSource.x - longSource.width;
  assert.ok(longGap > shortGap);
  assert.ok(longGap >= M.edgeLabelWidth(branch.label) + 56);
}

{
  const p = makeProject();
  p.viewSettings = {
    notes: { enabled: true, position: 'top' },
    branchColors: { enabled: false },
    nodeOffsets: { [p.rootId]: { x: 70.4, y: -20.2 }, missing: { x: 9, y: 10 }, broken: { x: 'x', y: 2 } },
    theme: { preset: 'custom', savedPresetId: 'theme-demo', colors: { canvas: '#123456', text: '#abcdef', branchPalette1: '#13579b', ignored: '#ffffff', panel: 'invalid' } }
  };
  const normalized = M.normalizeProject(p);
  assert.deepEqual(normalized.viewSettings.notes, { enabled: true, position: 'top' });
  assert.deepEqual(normalized.viewSettings.branchColors, { enabled: false });
  assert.deepEqual(normalized.viewSettings.nodeOffsets, { [p.rootId]: { x: 70, y: -20 } });
  assert.equal(normalized.viewSettings.theme.preset, 'custom');
  assert.equal(normalized.viewSettings.theme.savedPresetId, 'theme-demo');
  assert.deepEqual(normalized.viewSettings.theme.colors, { canvas: '#123456', text: '#ABCDEF', branchPalette1: '#13579B' });

  delete p.viewSettings;
  const legacy = M.normalizeProject(p);
  assert.deepEqual(legacy.viewSettings, M.defaultViewSettings());
}

{
  const p = makeProject();
  p.nodes[0].notes = '跟随节点移动的备注';
  p.viewSettings.notes = { enabled: true, position: 'right' };
  const automatic = M.layoutGraph(p);
  const automaticNode = automatic.positions.get(p.rootId);
  const automaticNote = automatic.noteBoxes.get(p.rootId);
  p.viewSettings.nodeOffsets = { [p.rootId]: { x: 180, y: 95 } };
  const moved = M.layoutGraph(p);
  const movedNode = moved.positions.get(p.rootId);
  const movedNote = moved.noteBoxes.get(p.rootId);
  assert.equal(movedNode.x - automaticNode.x, 180);
  assert.equal(movedNode.y - automaticNode.y, 95);
  assert.equal(movedNote.x - automaticNote.x, 180);
  assert.equal(movedNote.y - automaticNote.y, 95);
  assert.equal(moved.basePositions.get(p.rootId).x, automatic.basePositions.get(p.rootId).x);
  assert.ok(moved.width > automatic.width);
}

{
  const p = makeProject();
  p.nodes[0].notes = '元节点旁边显示的画布备注';
  p.viewSettings.notes = { enabled: true, position: 'top' };
  const layout = M.layoutGraph(p);
  const rootPosition = layout.positions.get(p.rootId);
  const noteBox = layout.noteBoxes.get(p.rootId);
  assert.ok(noteBox);
  assert.equal(noteBox.position, 'top');
  assert.ok(noteBox.y + noteBox.height < rootPosition.y);
  assert.ok(layout.obstacles.some(item => item.type === 'note' && item.ownerId === p.rootId));
}

{
  const p = makeProject();
  p.nodes.push(node('route-a', 'A'), node('route-b', 'B'), node('route-c', 'C'));
  p.branchLines.push(
    line('route-root-a', p.rootId, 'route-a'),
    line('route-root-b', p.rootId, 'route-b'),
    line('route-root-c', p.rootId, 'route-c')
  );
  const layout = M.layoutGraph(p);
  const routes = M.routeBranchLines(p, layout);
  const startPorts = [...routes.values()].map(route => route.startY);
  assert.equal(new Set(startPorts).size, 3);
  assert.ok([...routes.values()].every(route => route.d.startsWith('M ') && route.points.length >= 2));
}

{
  const p = makeProject();
  p.nodes.push(node('color-a', 'A'), node('color-b', 'B'), node('color-shared', '共同目标'));
  p.branchLines.push(
    line('color-root-a', p.rootId, 'color-a'),
    line('color-root-b', p.rootId, 'color-b'),
    line('color-a-shared', 'color-a', 'color-shared'),
    line('color-b-shared', 'color-b', 'color-shared')
  );
  const layout = M.layoutGraph(p);
  const routes = M.routeBranchLines(p, layout);
  const slots = M.assignBranchColorSlots(p, layout, routes, 8);
  const rootOutboundSlots = p.branchLines.filter(branch => branch.sourceId === p.rootId).map(branch => slots.get(branch.sourceId));
  assert.equal(rootOutboundSlots.length, 2);
  assert.equal(new Set(rootOutboundSlots).size, 1);
  assert.notEqual(slots.get('color-a'), slots.get('color-b'));
  assert.ok([...slots.values()].every(slot => Number.isInteger(slot) && slot >= 0 && slot < 8));
}

{
  const p = makeProject();
  p.nodes.push(node('manual-target', '手动线路目标'));
  const branch = line('manual-line', p.rootId, 'manual-target');
  branch.route = { mode: 'manual', points: [{ x: 412, y: 137 }] };
  p.branchLines.push(branch);
  const layout = M.layoutGraph(p);
  const geometry = M.routeBranchLines(p, layout).get(branch.id);
  assert.deepEqual(geometry.seedPoints, [{ x: 412, y: 137 }]);
  assert.ok(geometry.points.some(point => point.x === 412 && point.y === 137));

  branch.route.points.push({ x: 'bad', y: 100 }, { x: -20, y: 200000 });
  const normalized = M.normalizeProject(p);
  assert.deepEqual(normalized.branchLines[0].route, {
    mode: 'manual',
    points: [{ x: 412, y: 137 }, { x: 0, y: 100000 }]
  });
  const exported = M.buildAiExport(normalized);
  assert.equal(exported.viewSettings.theme.preset, 'midnight');
  assert.equal(exported.branchLines[0].route.mode, 'manual');
  assert.match(exported.aiReadingGuide.visualSettings, /不改变剧情方向/);
}

{
  const expression = global.StoryExpression;
  const definitions = [{ id: 'age', name: '年龄', initialValue: 30 }];
  assert.equal(expression.evaluateSource('[年龄] = 3e1', { age: 30 }, definitions), true);
  assert.equal(expression.evaluateSource('sqrt([年龄] - 5) ≥ 5', { age: 30 }, definitions), true);
  assert.equal(expression.renameVariable('[年龄] >= 18', '年龄', '角色年龄'), '[角色年龄] >= 18');
}

console.log('model tests passed');
