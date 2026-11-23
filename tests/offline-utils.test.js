const test = require('node:test')
const assert = require('node:assert/strict')

const {
	extractOfflineLinks,
	normalizeFilterTerms,
	sanitizeName,
	isEmptyFolderItems,
	getTaskFolderCidCandidates,
	isListingOfCid,
	findTaskFolderInList,
	isTaskSingleFile,
} = require('../extension/offline-utils.js')

test('从同一行空格分隔文本中批量提取磁力链接', () => {
	const input = [
		'magnet:?xt=urn:btih:19FFE9F49396BBF875C45F13031A51F93F82CD94',
		'magnet:?xt=urn:btih:B20D9F2D204E5F5F47E6061B971879717B8D28DE',
		'magnet:?xt=urn:btih:E680EC839B7F085AC4D9083F60BA531CDD134330',
		'magnet:?xt=urn:btih:CC043802CBBB36429154794A860AC82A1D0543B5',
	].join(' ')

	assert.deepEqual(extractOfflineLinks(input), input.split(' '))
})

test('保留磁力参数、支持换行与 ed2k，并按链接去重', () => {
	const magnet = 'magnet:?xt=urn:btih:b2c9a4bc5c6d03cac4f2fdcef8034632fc286d3e&dn=Mayday%202026'
	const ed2k = 'ed2k://|file|demo.mkv|123|0123456789ABCDEF0123456789ABCDEF|/'
	const input = `${magnet}\n${ed2k}\n${magnet.toUpperCase()}。`

	assert.deepEqual(extractOfflineLinks(input), [magnet, ed2k])
})

test('忽略不完整或不受支持的文本', () => {
	assert.deepEqual(extractOfflineLinks('magnet:?xt=urn:btih:1234 https://example.com'), [])
})

test('支持 base32 info hash 并清理句末中文标点', () => {
	const link = 'magnet:?xt=urn:btih:ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
	assert.deepEqual(extractOfflineLinks(`${link}。`), [link])
})

test('过滤词支持 Markdown 链接和反斜杠转义', () => {
	const terms = normalizeFilterTerms([
		'【高清剧集网发布 [www.BPHDTV.com](http://www.BPHDTV.com)】',
		'www\\.Example\\.com',
	].join('\n'))

	assert.deepEqual(terms, ['【高清剧集网发布 www.BPHDTV.com】', 'www.Example.com'])
})

test('过滤词数组会忽略空值并按大小写去重', () => {
	assert.deepEqual(normalizeFilterTerms([' 广告 ', '', '广告', 'AD', 'ad']), ['广告', 'AD'])
})

test('从文件夹或文件名中删除全部广告词并整理空白', () => {
	const source = '【高清剧集网发布 www.BPHDTV.com】醒来[全22集][国语配音+中文字幕].Awaken.S01.2026.mkv'
	const result = sanitizeName(source, ['【高清剧集网发布 www.BPHDTV.com】'])

	assert.equal(result, '醒来[全22集][国语配音+中文字幕].Awaken.S01.2026.mkv')
})

test('过滤词不匹配或会清空整个名称时不生成危险名称', () => {
	assert.equal(sanitizeName('movie.mkv', ['广告']), 'movie.mkv')
	assert.equal(sanitizeName('广告', ['广告']), '广告')
})

test('只有真正没有子项的目录才视为空文件夹', () => {
	assert.equal(isEmptyFolderItems([]), true)
	assert.equal(isEmptyFolderItems([{ fid: '1', sha: 'file-sha' }]), false)
	assert.equal(isEmptyFolderItems(null), false)
})

test('任务目录候选排除保存目录、根目录与 wppath_id', () => {
	const task = { file_id: '123456789', dir_id: '123456789', wppath_id: '987654321', fileId: '0' }
	assert.deepEqual(getTaskFolderCidCandidates(task, '987654321'), ['123456789'])
	assert.deepEqual(getTaskFolderCidCandidates({ file_id: '987654321' }, '987654321'), [])
	assert.deepEqual(getTaskFolderCidCandidates({ wppath_id: '123456789' }, '0'), [])
})

test('目录列表必须确实属于请求的 cid', () => {
	assert.equal(isListingOfCid({ cid: '123456789', data: [] }, '123456789'), true)
	assert.equal(isListingOfCid({ cid: 0, data: [{}] }, '123456789'), false)
	assert.equal(isListingOfCid({ data: [], path: [{ cid: 0 }, { cid: 111 }] }, '123456789'), false)
	assert.equal(isListingOfCid({ state: false }, '123456789'), false)
	assert.equal(isListingOfCid({ cid: '0', data: [] }, '0'), false)
})

test('按名称匹配任务目录时容忍 115 替换的特殊字符', () => {
	const items = [
		{ n: 'Other Folder', cid: '111' },
		{ n: 'Demo Show_S01 1080p', cid: '222' },
		{ n: 'Demo Show: S01 1080p.mkv', fid: '333', sha: 'x' },
	]
	assert.equal(findTaskFolderInList(items, 'Demo Show: S01 1080p'), '222')
	assert.equal(findTaskFolderInList(items, 'Missing'), '')
})

test('模糊匹配到多个目录时拒绝猜测', () => {
	const items = [
		{ n: 'Demo Pack A', cid: '111' },
		{ n: 'Demo Pack B', cid: '222' },
	]
	assert.equal(findTaskFolderInList(items, 'Demo Pack'), '')
	assert.equal(findTaskFolderInList([{ n: 'Demo Pack', cid: '333' }, ...items], 'Demo Pack'), '333')
})

test('识别没有独立目录的单文件任务', () => {
	const items = [{ n: 'demo.video.mp4', fid: '444', sha: 'x' }]
	assert.equal(isTaskSingleFile(items, 'demo.video.mp4'), true)
	assert.equal(isTaskSingleFile(items, 'demo.video'), true)
	assert.equal(isTaskSingleFile(items, 'another'), false)
	assert.equal(isTaskSingleFile([{ n: 'demo.video.mp4', cid: '555' }], 'demo.video.mp4'), false)
})
