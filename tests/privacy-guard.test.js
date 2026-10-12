const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
function scan(input) {
 return spawnSync('python3', ['scripts/check-privacy.py', '--stdin'], { input, encoding: 'utf8' })
}
test('隐私检查阻止私人邮箱、本机路径、长凭据并隐藏值',()=> {
 const samples = [ ['private','example.org'].join('@'), ['', 'Users', 'person', 'project'].join('/'), ['SEID', JSON.stringify('x'.repeat(40))].join('='), 'Preprocess:'+'3'.repeat(19) ]
 for (const value of samples) {
  const result=scan(value)
  assert.equal(result.status,1)
  assert.ok(!result.stderr.includes(value))
 }
})
test('允许GitHub匿名邮箱、短示例和目录占位值',()=> {
 for (const value of ['19942206+LeventLei@users.noreply.github.com', 'Preprocess:123456789', 'SEID="sample"']) assert.equal(scan(value).status,0)
})
