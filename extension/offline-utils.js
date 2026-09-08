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

	const api = {
		extractOfflineLinks,
		normalizeFilterTerms,
		sanitizeName,
	}

	global.Push115OfflineUtils = api
	if (typeof module !== 'undefined' && module.exports) module.exports = api
})(typeof window !== 'undefined' ? window : globalThis)
