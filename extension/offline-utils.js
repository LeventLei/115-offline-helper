;(function (global) {
	'use strict'

	const MAGNET_PATTERN = /magnet:\?xt=urn:btih:(?:[a-f0-9]{40}|[a-z2-7]{32})(?:&[^\s<>"']*)?/gi
	const ED2K_PATTERN = /ed2k:\/\/\|file\|[^|\r\n]+\|\d+\|[a-f0-9]{32}\|\/?/gi
	const TRAILING_PUNCTUATION = /[),.;!?，。；！？）】]+$/u

	function extractOfflineLinks(rawText) {
		const text = String(rawText || '')
		const found = []

		for (const pattern of [MAGNET_PATTERN, ED2K_PATTERN]) {
			pattern.lastIndex = 0
			let match
			while ((match = pattern.exec(text)) !== null) {
				const value = match[0].replace(TRAILING_PUNCTUATION, '')
				if (value) found.push({ index: match.index, value })
			}
		}

		found.sort((a, b) => a.index - b.index)
		const seen = new Set()
		return found
			.map(item => item.value)
			.filter(value => {
				const key = value.toLowerCase()
				if (seen.has(key)) return false
				seen.add(key)
				return true
			})
	}

	function normalizeFilterTerm(rawTerm) {
		return String(rawTerm || '')
			.trim()
			.replace(/\[([^\]]+)]\((?:https?:\/\/)?[^)]+\)/gi, '$1')
			.replace(/\\(.)/g, '$1')
			.trim()
	}

	function normalizeFilterTerms(rawText) {
		const source = Array.isArray(rawText) ? rawText : String(rawText || '').split(/\r?\n/)
		const seen = new Set()
		const result = []

		for (const rawTerm of source) {
			const term = normalizeFilterTerm(rawTerm)
			if (!term) continue
			const key = term.toLocaleLowerCase()
			if (seen.has(key)) continue
			seen.add(key)
			result.push(term)
		}
		return result
	}

	function escapeRegExp(value) {
		return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	}

	function sanitizeName(rawName, rawTerms) {
		const original = String(rawName || '')
		const terms = normalizeFilterTerms(rawTerms)
		let cleaned = original

		for (const term of terms) {
			cleaned = cleaned.replace(new RegExp(escapeRegExp(term), 'gi'), '')
		}

		cleaned = cleaned.replace(/[\t\u00a0 ]{2,}/g, ' ').trim()
		return cleaned || original
	}

	function isEmptyFolderItems(items) {
		return Array.isArray(items) && items.length === 0
	}

	function normalizeFolderCid(value) {
		const cid = String(value ?? '').trim()
		return /^\d+$/.test(cid) && cid !== '0' ? cid : ''
	}

	// 115 任务的 wppath_id 是保存目录本身，不能当作任务目录；与保存目录相同的候选也一律排除。
	function getTaskFolderCidCandidates(task, savePathCid) {
		const saveCid = String(savePathCid ?? '').trim()
		const seen = new Set()
		return [task?.file_id, task?.fileId, task?.dir_id, task?.dirId]
			.map(normalizeFolderCid)
			.filter(cid => {
				if (!cid || cid === saveCid || seen.has(cid)) return false
				seen.add(cid)
				return true
			})
	}

	// 115 对无效 cid 可能回退返回其他目录的列表，需核对响应中的 cid 与路径末级。
	function isListingOfCid(response, cid) {
		const target = normalizeFolderCid(cid)
		if (!target || !response || !Array.isArray(response.data)) return false
		if (response.cid !== undefined && response.cid !== null && String(response.cid) !== target) return false
		const path = Array.isArray(response.path) ? response.path : []
		const last = path[path.length - 1]
		if (last && last.cid !== undefined && last.cid !== null && String(last.cid) !== target) return false
		return true
	}

	function normalizeTaskName(value) {
		return String(value || '')
			.normalize('NFKC')
			.toLocaleLowerCase()
			.replace(/[\s\\/:*?"<>|._\-+=~`'!@#$%^&;,，。、（）()[\]{}【】《》]+/gu, '')
	}

	function stripExtension(name) {
		return String(name || '').replace(/\.[a-z0-9]{1,6}$/i, '')
	}

	// 只在保存目录的直接子文件夹中查找；列表按上传时间倒序，精确匹配取最新一个，模糊匹配出现多个候选时视为无法确认。
	function findTaskFolderInList(items, taskName) {
		const target = normalizeTaskName(taskName)
		if (!target || !Array.isArray(items)) return ''
		const folders = items.filter(item => item && !item.sha)
		const nameOf = item => normalizeTaskName(item.n || item.name)
		const exact = folders.find(item => nameOf(item) === target)
		if (exact) return normalizeFolderCid(exact.cid || exact.fid)
		const fuzzy = folders.filter(item => nameOf(item).includes(target))
		return fuzzy.length === 1 ? normalizeFolderCid(fuzzy[0].cid || fuzzy[0].fid) : ''
	}

	function isTaskSingleFile(items, taskName) {
		const target = normalizeTaskName(taskName)
		const targetStem = normalizeTaskName(stripExtension(taskName))
		if (!target || !Array.isArray(items)) return false
		return items.some(item => {
			if (!item || !item.sha) return false
			const raw = item.n || item.name
			const name = normalizeTaskName(raw)
			const stem = normalizeTaskName(stripExtension(raw))
			return name === target || stem === target || (targetStem && stem === targetStem)
		})
	}

	const api = {
		extractOfflineLinks,
		normalizeFilterTerms,
		sanitizeName,
		isEmptyFolderItems,
		getTaskFolderCidCandidates,
		isListingOfCid,
		normalizeTaskName,
		findTaskFolderInList,
		isTaskSingleFile,
	}

	global.Push115OfflineUtils = api
	if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
