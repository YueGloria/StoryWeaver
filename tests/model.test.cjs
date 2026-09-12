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
  const expression = global.StoryExpression;
  const definitions = [{ id: 'age', name: '年龄', initialValue: 30 }];
  assert.equal(expression.evaluateSource('[年龄] = 3e1', { age: 30 }, definitions), true);
  assert.equal(expression.evaluateSource('sqrt([年龄] - 5) ≥ 5', { age: 30 }, definitions), true);
  assert.equal(expression.renameVariable('[年龄] >= 18', '年龄', '角色年龄'), '[角色年龄] >= 18');
}

console.log('model tests passed');
