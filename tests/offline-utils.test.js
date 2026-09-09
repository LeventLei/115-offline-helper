const test = require('node:test')
const assert = require('node:assert/strict')

const {
	extractOfflineLinks,
	normalizeFilterTerms,
	sanitizeName,
	isEmptyFolderItems,
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
