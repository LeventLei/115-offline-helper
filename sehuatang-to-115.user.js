// ==UserScript==
// @name         98tangTo115
// @namespace    http://tampermonkey.net/
// @version      2.0.1
// @description  自动检测复制的 magnet/ed2k 链接，一键推送到 115 网盘离线下载
// @author       gangz1o
// @match        *://*.sehuatang.net/*
// @match        *://*sehuatang.net*/*
// @match        *://*javdb*/*
// @match        *://*.javdb565.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_notification
// @grant        GM_addStyle
// @grant        GM_cookie
// @connect      115.com
// @connect      my.115.com
// @connect      webapi.115.com
// @license      MIT
// @run-at       document-start
// ==/UserScript==

;(function () {
	'use strict'

	// ========== 配置相关 ==========
	const CONFIG_KEYS = {
		SAVE_PATH: '115_save_path',
		SAVE_PATH_CID: '115_save_path_cid',
		AUTO_ORGANIZE: '115_auto_organize',
		AUTO_DELETE_SMALL: '115_auto_delete_small',
		DELETE_SIZE_THRESHOLD: '115_delete_size_threshold',
		PANEL_MINIMIZED: '115_panel_minimized',
		COOKIE: '115_cookie',
	}

	// 默认配置
	const DEFAULT_CONFIG = {
		[CONFIG_KEYS.SAVE_PATH]: '离线下载',
		[CONFIG_KEYS.SAVE_PATH_CID]: '0',
		[CONFIG_KEYS.AUTO_ORGANIZE]: false,
		[CONFIG_KEYS.AUTO_DELETE_SMALL]: false,
		[CONFIG_KEYS.DELETE_SIZE_THRESHOLD]: 100,
		[CONFIG_KEYS.PANEL_MINIMIZED]: true,
	}

	// 视频文件扩展名
	const VIDEO_EXTENSIONS = [
		'.mp4',
		'.mkv',
		'.avi',
		'.wmv',
		'.mov',
		'.flv',
		'.rmvb',
		'.rm',
		'.ts',
		'.m2ts',
		'.webm',
		'.m4v',
		'.3gp',
		'.mpeg',
		'.mpg',
	]

	// 获取配置
	function getConfig(key) {
		return GM_getValue(key, DEFAULT_CONFIG[key])
	}

	// 设置配置
	function setConfig(key, value) {
		GM_setValue(key, value)
	}

	// 展开面板
	function expandPanel() {
		const panel = document.getElementById('push115-panel')
		if (panel && panel.classList.contains('minimized')) {
			panel.classList.remove('minimized')
			// 不保存状态，因为这是临时展开
		}
	}

	// 折叠面板
	function collapsePanel() {
		const panel = document.getElementById('push115-panel')
		if (panel && !panel.classList.contains('minimized')) {
			panel.classList.add('minimized')
			setConfig(CONFIG_KEYS.PANEL_MINIMIZED, true)
		}
	}

	// ========== 115 网盘 API ==========
	class API115 {
		constructor() {
			this.headers = {
				'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
				Accept: 'application/json, text/javascript, */*; q=0.01',
				Origin: 'https://115.com',
				'User-Agent':
					'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 115Browser/27.0.0',
				Referer: 'https://115.com/?cid=0&offset=0&mode=wangpan',
				'X-Requested-With': 'XMLHttpRequest',
			}
			this._uid = null
			this._sign = null
			this._time = null
			this._cookie = getConfig(CONFIG_KEYS.COOKIE)
		}

		// 通用请求方法
		request(url, method = 'GET', data = null, customHeaders = {}) {
			return new Promise((resolve, reject) => {
				const headers = { ...this.headers, ...customHeaders }
				// 移除值为 null 的 header
				Object.keys(headers).forEach(key => {
					if (headers[key] === null) delete headers[key]
				})

				const options = {
					method: method,
					url: url,
					headers: headers,
					withCredentials: !this._cookie,
					onload: response => {
						try {
							const result = JSON.parse(response.responseText)
							resolve(result)
						} catch (e) {
							const preview = response.responseText.substring(0, 150).replace(/[\r\n]/g, ' ')
							reject(new Error(`解析响应失败: ${e.message} (Response: ${preview}...)`))
						}
					},
					onerror: error => {
						reject(new Error('请求失败: ' + error.statusText))
					},
				}

				if (data) {
					if (typeof data === 'object') {
						options.data = new URLSearchParams(data).toString()
					} else {
						options.data = data
					}
				}

				if (this._cookie) {
					options.headers['Cookie'] = this._cookie
				}

				GM_xmlhttpRequest(options)
			})
		}

		// 检查登录状态
		async checkLogin() {
			try {
				const result = await this.request('https://my.115.com/?ct=guide&ac=status')
				return result.state === true
			} catch (e) {
				console.error('检查登录状态失败:', e)
				return false
			}
		}

		// 获取 UID
		async getUid() {
			if (this._uid) return this._uid
			try {
				const result = await this.request('https://my.115.com/?ct=ajax&ac=get_user_aq')
				if (result.state === true && result.data && result.data.uid) {
					this._uid = result.data.uid
					return this._uid
				}
				throw new Error('获取 UID 失败')
			} catch (e) {
				throw new Error('获取 UID 失败: ' + e.message)
			}
		}

		// 获取 Sign 和 Time
		async getSignAndTime() {
			if (this._sign && this._time) {
				return { sign: this._sign, time: this._time }
			}
			try {
				const result = await this.request('https://115.com/?ct=offline&ac=space')
				if (result.state === true && result.sign && result.time) {
					this._sign = result.sign
					this._time = result.time
					return { sign: this._sign, time: this._time }
				}
				throw new Error('获取 Sign 和 Time 失败')
			} catch (e) {
				throw new Error('获取 Sign 和 Time 失败: ' + e.message)
			}
		}

		// 添加离线下载任务
		async addOfflineTask(url) {
			const isLoggedIn = await this.checkLogin()
			if (!isLoggedIn) {
				throw new Error('未登录 115 网盘，请先在 115.com 登录')
			}

			const uid = await this.getUid()
			const { sign, time } = await this.getSignAndTime()
			const cid = getConfig(CONFIG_KEYS.SAVE_PATH_CID)

			const formData = {
				url: url,
				savepath: '',
				wp_path_id: cid,
				uid: uid,
				sign: sign,
				time: time,
			}

			const result = await this.request('https://115.com/web/lixian/?ct=lixian&ac=add_task_url', 'POST', formData)

			if (result.state !== true) {
				throw new Error(result.error_msg || '添加任务失败')
			}

			return result
		}

		// 获取离线任务列表
		async getOfflineTasks() {
			const result = await this.request('https://115.com/web/lixian/?ct=lixian&ac=task_lists')
			if (result.state !== true) {
				throw new Error('获取任务列表失败')
			}
			return result.tasks || []
		}

		// 获取文件列表
		async getFileList(cid = '0') {
			const result = await this.request(
				`https://webapi.115.com/files?aid=1&cid=${cid}&o=user_ptime&asc=0&offset=0&show_dir=1&limit=500&snap=0&natsort=1`,
			)
			return result
		}

		// 创建文件夹
		async createFolder(parentCid, folderName) {
			const formData = {
				pid: parentCid,
				cname: folderName,
			}
			const result = await this.request('https://webapi.115.com/files/add', 'POST', formData)
			return result
		}

		// 移动文件
		async moveFile(fileId, targetCid) {
			const formData = {
				fid: fileId,
				pid: targetCid,
				move_proid: '',
			}
			const result = await this.request('https://webapi.115.com/files/move', 'POST', formData)
			return result
		}

		// 重命名文件或文件夹
		async renameFileOrFolder(fileId, newName) {
			if (!fileId || !newName) return { state: false, error: '参数错误' }
			const formData = {
				fid: fileId,
				name: newName,
			}
			const result = await this.request('https://webapi.115.com/files/edit', 'POST', formData)
			return result
		}

		// 删除文件
		async deleteFiles(fileIds) {
			if (!Array.isArray(fileIds)) {
				fileIds = [fileIds]
			}

			// 构建 fid[0]=xxx&fid[1]=yyy 格式的参数
			const params = new URLSearchParams()
			fileIds.forEach((fid, index) => {
				params.append(`fid[${index}]`, fid)
			})
			params.append('ignore_warn', '1')

			const result = await this.request('https://webapi.115.com/rb/delete', 'POST', params.toString())
			return result
		}

		// 清理小文件（递归扫描子文件夹）
		async cleanSmallFiles(cid, thresholdMB) {
			const thresholdBytes = thresholdMB * 1024 * 1024
			let allSmallFiles = []

			const scanFolder = async (folderId, depth = 0) => {
				if (depth > 3) return

				const fileList = await this.getFileList(folderId)
				if (!fileList.data || !Array.isArray(fileList.data)) return

				console.log(`[清理] 扫描目录，找到 ${fileList.data.length} 个项目`)

				for (const item of fileList.data) {
					const fileName = item.n || item.name || ''

					// 判断是否为文件夹（没有 sha 的是文件夹）
					if (!item.sha) {
						const folderCid = item.cid || item.fid
						if (folderCid && folderCid !== folderId) {
							console.log(`[清理] 进入子文件夹: ${fileName}`)
							await scanFolder(folderCid, depth + 1)
						}
						continue
					}

					// 是文件，检查大小
					const fileSize = item.size || item.s || 0

					if (fileSize > 0 && fileSize < thresholdBytes) {
						console.log(`[清理] 发现小文件: ${fileName} (${(fileSize / 1024).toFixed(2)} KB)`)
						allSmallFiles.push({ fid: item.fid, name: fileName, size: fileSize })
					}
				}
			}

			await scanFolder(cid)

			console.log(`[清理] 总共找到 ${allSmallFiles.length} 个小文件`)

			if (allSmallFiles.length === 0) {
				return { deleted: 0, files: [] }
			}

			const fileIds = allSmallFiles.map(f => f.fid)
			const fileNames = allSmallFiles.map(f => f.name)

			console.log('[清理] 准备删除文件 IDs:', fileIds)
			const deleteResult = await this.deleteFiles(fileIds)
			console.log('[清理] 删除 API 返回:', deleteResult)

			if (deleteResult.state !== true) {
				console.error('[清理] 删除失败:', deleteResult)
				throw new Error(deleteResult.error || '删除失败')
			}

			return { deleted: allSmallFiles.length, files: fileNames }
		}

		// 整理视频文件到独立文件夹
		async organizeVideosToFolders(sourceCid, currentFolderName = '', targetParentCid = null) {
			const fileList = await this.getFileList(sourceCid)

			if (!fileList.data || !Array.isArray(fileList.data)) {
				console.log('[整理] 未找到文件列表数据')
				return { organized: 0, files: [] }
			}

			// 筛选直接在目录下的视频文件（不在子文件夹中的）
			const videoFiles = fileList.data.filter(f => {
				// 文件必须有 sha（文件夹没有）
				if (!f.sha) return false
				// 检查是否为视频文件
				const fileName = (f.n || f.name || '').toLowerCase()
				return VIDEO_EXTENSIONS.some(ext => fileName.endsWith(ext))
			})

			console.log(`[整理] 找到 ${videoFiles.length} 个视频文件需要整理`)

			if (videoFiles.length === 0) {
				return { organized: 0, files: [] }
			}

			let organizedCount = 0
			const organizedFiles = []

			for (const video of videoFiles) {
				try {
					const fileName = video.n || video.name
					const extMatch = fileName.match(/\.[^.]+$/)
					const ext = extMatch ? extMatch[0] : ''
					const code = extractVideoCode(fileName)
					const folderName = code || fileName.replace(/\.[^.]+$/, '').toUpperCase()
					const currentNameNormalized = normalizeCode(currentFolderName)
					const folderNameNormalized = normalizeCode(folderName)
					const shouldSkipFolder =
						targetParentCid === null &&
						currentNameNormalized &&
						folderNameNormalized &&
						(currentNameNormalized === folderNameNormalized ||
							currentNameNormalized.includes(folderNameNormalized) ||
							folderNameNormalized.includes(currentNameNormalized))

					let canRename = false
					if (shouldSkipFolder) {
						console.log(`[整理] 当前目录已包含目标名称，跳过创建子文件夹: ${fileName}`)
						canRename = true
					} else {
						console.log(`[整理] 处理视频: ${fileName} -> 文件夹: ${folderName}`)

						const parentCid = targetParentCid || sourceCid
						const createResult = await this.createFolder(parentCid, folderName)

						let targetCid
						if (createResult.cid) {
							targetCid = createResult.cid
						} else if (createResult.file_id) {
							targetCid = createResult.file_id
						} else {
							const updatedList = await this.getFileList(parentCid)
							const folder = updatedList.data?.find(f => !f.sha && (f.n || f.name)?.toUpperCase() === folderName)
							if (folder) {
								targetCid = folder.cid || folder.fid
							} else {
								console.log(`[整理] 无法获取文件夹 CID`)
								targetCid = null
							}
						}

						if (targetCid) {
							const moveResult = await this.moveFile(video.fid, targetCid)
							if (moveResult.state === true) {
								organizedCount++
								organizedFiles.push(fileName)
								console.log(`[整理] 成功: ${fileName} -> ${folderName}/`)
								canRename = true
							} else {
								console.log(`[整理] 移动文件失败:`, moveResult)
							}
						}
					}

					if (code && canRename) {
						const newName = `${code}${ext}`
						if (newName && newName !== fileName) {
							const renameResult = await this.renameFileOrFolder(video.fid, newName)
							if (renameResult.state === true) {
								console.log(`[整理] 重命名成功: ${fileName} -> ${newName}`)
							} else {
								console.log(`[整理] 重命名失败:`, renameResult)
							}
						}
					}

					// 短暂延迟
					await new Promise(resolve => setTimeout(resolve, 500))
				} catch (e) {
					console.error(`[整理] 处理视频失败:`, e)
				}
			}

			return { organized: organizedCount, files: organizedFiles }
		}

		// 获取二维码 Token
		async getQRCodeToken() {
			const result = await this.request('https://qrcodeapi.115.com/api/1.0/web/1.0/token/')
			if (result.state !== 1 || !result.data || !result.data.uid) {
				throw new Error('获取二维码 Token 失败')
			}
			return result.data
		}

		// 获取二维码状态
		async getQRCodeStatus(uid, time, sign) {
			const result = await this.request(
				`https://qrcodeapi.115.com/get/status/?uid=${uid}&time=${time}&sign=${sign}&_=${Date.now()}`,
			)
			if (result.state !== 1 || !result.data) {
				throw new Error('获取二维码状态失败')
			}
			return result.data
		}

		// 二维码登录（换取 Cookie）
		async loginQRCode(uid, app = 'web') {
			const formData = {
				account: uid,
				app: app,
			}

			// 针对不同端设置 User-Agent 和 Header
			const customHeaders = {}
			const userAgents = {
				android:
					'Mozilla/5.0 (Linux; Android 13; SM-S9080 Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/108.0.5359.128 Mobile Safari/537.36 115Browser/30.4.0',
				ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 115Browser/30.4.0',
				ipad: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 115Browser/30.4.0',
				tv: 'Mozilla/5.0 (Linux; Android 10; TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.149 Safari/537.36 115Browser/30.4.0',
				wechatmini:
					'Mozilla/5.0 (Linux; Android 13; SM-S9080 Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/108.0.5359.128 Mobile Safari/537.36 XWEB/5023 MMWEBSDK/20230202 MMWEBID/8888 MicroMessenger/8.0.33.2320(0x28002151) WeChat/arm64 Weixin NetType/WIFI Language/zh_CN ABI/arm64 MiniProgramEnv/android',
				alipaymini:
					'Mozilla/5.0 (Linux; Android 13; SM-S9080 Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/111.0.5563.116 Mobile Safari/537.36 Ariver/1.0.0 AliApp(AP/10.3.86.6000) Nebula AlipayDefined(nt:WIFI,ws:360|0|3.0) AliApp(AP/10.3.86.6000) AlipayClient/10.3.86.6000 Language/zh-Hans Region/CN',
			}

			if (app !== 'web') {
				customHeaders['Origin'] = null // 移除 Origin
				customHeaders['Referer'] = null // 移除 Referer
				// 设置对应的 User-Agent
				if (userAgents[app]) {
					customHeaders['User-Agent'] = userAgents[app]
				} else if (app === 'qandroid') {
					customHeaders['User-Agent'] = userAgents['android'] // 复用 Android UA
				} else if (app === 'qios') {
					customHeaders['User-Agent'] = userAgents['ios'] // 复用 iOS UA
				}
			}

			// 这里需要用 POST 请求 passportapi
			// 注意：passportapi 返回的数据中包含 cookie
			const result = await this.request(
				`https://passportapi.115.com/app/1.0/${app}/1.0/login/qrcode/`,
				'POST',
				formData,
				customHeaders,
			)

			if (result.state !== 1 || !result.data || !result.data.cookie) {
				throw new Error(result.error || '登录失败，无法获取 Cookie')
			}

			// 保存 Cookie
			if (result.data.cookie) {
				// 格式化 cookie: UID=xxx; CID=xxx; SEID=xxx
				let cookieStr = ''
				if (typeof result.data.cookie === 'object') {
					const parts = []
					if (result.data.cookie.UID) parts.push(`UID=${result.data.cookie.UID}`)
					if (result.data.cookie.CID) parts.push(`CID=${result.data.cookie.CID}`)
					if (result.data.cookie.SEID) parts.push(`SEID=${result.data.cookie.SEID}`)
					cookieStr = parts.join('; ')
				} else {
					cookieStr = result.data.cookie
				}

				this._cookie = cookieStr
				setConfig(CONFIG_KEYS.COOKIE, cookieStr)

				// 尝试同步到浏览器（如果支持）
				if (typeof GM_cookie !== 'undefined') {
					const cookies = cookieStr.split('; ')
					cookies.forEach(c => {
						const [name, value] = c.split('=')
						if (name && value) {
							GM_cookie.set(
								{
									url: 'https://115.com',
									name: name.trim(),
									value: value.trim(),
									domain: '.115.com',
									path: '/',
								},
								function (error) {
									if (error) {
										console.error('GM_cookie set error:', error)
									} else {
										console.log('GM_cookie set success:', name)
									}
								},
							)
						}
					})
				}
			}

			return result.data
		}
	}

	const api = new API115()

	// ========== UI 相关 ==========
	// Apple Liquid Glass 风格样式
	GM_addStyle(`
      .push115-panel {
          position: fixed;
          bottom: 20px;
          right: 20px;
          width: 300px;
          background: rgba(255, 255, 255, 0.72);
          backdrop-filter: blur(40px) saturate(180%);
          -webkit-backdrop-filter: blur(40px) saturate(180%);
          border-radius: 20px;
          border: 1px solid rgba(255, 255, 255, 0.5);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04);
          z-index: 999999;
          font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif;
          overflow: hidden;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }

      .push115-panel.minimized {
          width: 48px;
          height: 48px;
          border-radius: 24px;
          cursor: pointer;
      }

      .push115-panel.minimized .push115-content,
      .push115-panel.minimized .push115-header {
          display: none;
      }

      .push115-panel.minimized .push115-min-icon {
          display: flex;
      }

      .push115-min-icon {
          display: none;
          width: 48px;
          height: 48px;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          background: rgba(0, 122, 255, 0.1);
          color: #007AFF;
      }

      .push115-header {
          background: rgba(255, 255, 255, 0.5);
          border-bottom: 1px solid rgba(0, 0, 0, 0.06);
          padding: 14px 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
      }

      .push115-header-title {
          font-size: 15px;
          font-weight: 600;
          color: #1d1d1f;
          letter-spacing: -0.2px;
      }

      .push115-header-btns {
          display: flex;
          gap: 8px;
      }

      .push115-header-btn {
          background: rgba(0, 0, 0, 0.04);
          border: none;
          color: #8e8e93;
          width: 26px;
          width: 26px;
          height: 26px;
          border-radius: 13px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: 500;
          transition: all 0.2s;
          text-decoration: none;
          border-radius: 13px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: 500;
          transition: all 0.2s;
      }

      .push115-header-btn:hover {
          background: rgba(0, 0, 0, 0.08);
          color: #1d1d1f;
      }

      .push115-content {
          padding: 16px;
      }

      .push115-section {
          margin-bottom: 16px;
      }

      .push115-section:last-child {
          margin-bottom: 0;
      }

      .push115-label {
          display: block;
          font-size: 13px;
          font-weight: 500;
          color: #86868b;
          margin-bottom: 8px;
      }

      .push115-input {
          width: 100%;
          padding: 10px 14px;
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 10px;
          font-size: 14px;
          background: rgba(255, 255, 255, 0.8);
          box-sizing: border-box;
          transition: all 0.2s;
          color: #1d1d1f;
      }

      .push115-input:focus {
          outline: none;
          border-color: #007AFF;
          box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.15);
      }

      .push115-hint {
          font-size: 12px;
          color: #86868b;
          margin-top: 6px;
      }

      .push115-checkbox-group {
          display: flex;
          align-items: center;
          gap: 10px;
      }

      .push115-checkbox {
          width: 20px;
          height: 20px;
          cursor: pointer;
          accent-color: #007AFF;
      }

      .push115-checkbox-label {
          font-size: 14px;
          color: #1d1d1f;
          cursor: pointer;
      }

      .push115-row {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          color: #86868b;
      }

      .push115-row .push115-input {
          text-align: center;
      }

      .push115-status {
          padding: 12px 14px;
          border-radius: 12px;
          font-size: 13px;
          font-weight: 500;
          margin-bottom: 12px;
          animation: statusSlide 0.3s ease;
      }

      @keyframes statusSlide {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
      }

      .push115-status.success {
          background: rgba(52, 199, 89, 0.12);
          color: #248a3d;
      }

      .push115-status.error {
          background: rgba(255, 59, 48, 0.12);
          color: #d70015;
      }

      .push115-status.info {
          background: rgba(0, 122, 255, 0.12);
          color: #0066cc;
      }

      .push115-status.warning {
          background: rgba(255, 149, 0, 0.12);
          color: #c93400;
      }

      .push115-divider {
          height: 1px;
          background: rgba(0, 0, 0, 0.06);
          margin: 16px 0;
      }

      .push115-progress {
          margin-bottom: 12px;
      }

      .push115-progress.hidden {
          display: none;
      }

      .push115-progress-text {
          font-size: 12px;
          color: #86868b;
          margin-bottom: 6px;
      }

      .push115-progress-track {
          width: 100%;
          height: 8px;
          border-radius: 999px;
          background: rgba(0, 0, 0, 0.06);
          overflow: hidden;
          position: relative;
      }

      .push115-progress-bar {
          height: 100%;
          width: 30%;
          border-radius: 999px;
          background: linear-gradient(90deg, rgba(0, 122, 255, 0.2), rgba(0, 122, 255, 0.9));
          animation: progressIndeterminate 1.2s ease-in-out infinite;
      }

      .push115-progress-bar.determinate {
          animation: none;
      }

      @keyframes progressIndeterminate {
          0% { transform: translateX(-60%); }
          50% { transform: translateX(120%); }
          100% { transform: translateX(240%); }
      }

      /* 确认弹窗 */
      .push115-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.4);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          z-index: 9999999;
          display: flex;
          align-items: center;
          justify-content: center;
          animation: modalFade 0.2s ease;
      }

      @keyframes modalFade {
          from { opacity: 0; }
          to { opacity: 1; }
      }

      .push115-modal {
          background: rgba(255, 255, 255, 0.85);
          backdrop-filter: blur(40px) saturate(180%);
          -webkit-backdrop-filter: blur(40px) saturate(180%);
          border-radius: 20px;
          border: 1px solid rgba(255, 255, 255, 0.5);
          width: 380px;
          max-width: 90vw;
          box-shadow: 0 24px 80px rgba(0, 0, 0, 0.15);
          animation: modalSlide 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          overflow: hidden;
      }

      @keyframes modalSlide {
          from {
              opacity: 0;
              transform: scale(0.95) translateY(10px);
          }
          to {
              opacity: 1;
              transform: scale(1) translateY(0);
          }
      }

      .push115-modal-header {
          background: rgba(255, 255, 255, 0.5);
          border-bottom: 1px solid rgba(0, 0, 0, 0.06);
          padding: 18px 20px;
      }

      .push115-modal-title {
          font-size: 17px;
          font-weight: 600;
          color: #1d1d1f;
          margin: 0;
          letter-spacing: -0.2px;
      }

      .push115-modal-body {
          padding: 20px;
      }

      .push115-modal-link {
          background: rgba(0, 0, 0, 0.04);
          padding: 12px 14px;
          border-radius: 10px;
          word-break: break-all;
          font-size: 12px;
          color: #1d1d1f;
          max-height: 70px;
          overflow-y: auto;
          margin-bottom: 16px;
          font-family: 'SF Mono', Monaco, monospace;
      }

      .push115-modal-info {
          font-size: 14px;
          color: #86868b;
          margin-bottom: 8px;
          display: flex;
          align-items: center;
          gap: 6px;
      }

      .push115-modal-footer {
          padding: 16px 20px;
          display: flex;
          gap: 10px;
          justify-content: flex-end;
          background: rgba(0, 0, 0, 0.02);
      }

      .push115-btn {
          padding: 10px 20px;
          border: none;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
      }

      .push115-btn-primary {
          background: #007AFF;
          color: white;
      }

      .push115-btn-primary:hover {
          background: #0066d6;
      }

      .push115-btn-primary:active {
          transform: scale(0.98);
      }

      .push115-btn-secondary {
          background: rgba(0, 0, 0, 0.05);
          color: #007AFF;
      }

      .push115-btn-secondary:hover {
          background: rgba(0, 0, 0, 0.08);
      }

      .push115-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
      }

      .push115-loading {
          display: inline-block;
          width: 14px;
          height: 14px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
          margin-right: 8px;
      }

      @keyframes spin {
          to { transform: rotate(360deg); }
      }

      .push115-qrcode-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 20px;
      }
      .push115-qrcode-img {
          width: 200px;
          height: 200px;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      }
      .push115-qrcode-status {
          margin-top: 16px;
          font-size: 14px;
          color: #86868b;
          text-align: center;
      }
      .push115-qrcode-tip {
          font-size: 13px;
          color: #86868b;
          margin-top: 12px;
          text-align: center;
          line-height: 1.4;
      }

      .push115-select-wrapper {
          position: relative;
          width: 100%;
      }

      .push115-select-wrapper::after {
          content: '';
          position: absolute;
          right: 14px;
          top: 50%;
          transform: translateY(-50%);
          width: 10px;
          height: 10px;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2386868b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
          background-size: contain;
          background-repeat: no-repeat;
          pointer-events: none;
      }

      .push115-select {
          appearance: none;
          -webkit-appearance: none;
          width: 100%;
          padding: 12px 14px;
          padding-right: 34px;
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 12px;
          font-size: 15px;
          background: rgba(255, 255, 255, 0.8);
          color: #1d1d1f;
          cursor: pointer;
          transition: all 0.2s;
          text-align: left;
      }

      .push115-select:focus {
          outline: none;
          border-color: #007AFF;
          box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.15);
      }
  `)

	// 创建配置面板
	function createConfigPanel() {
		const panel = document.createElement('div')
		panel.className = 'push115-panel'
		panel.id = 'push115-panel'

		panel.innerHTML = `
          <div class="push115-min-icon" title="点击展开"><h3 class="push115-modal-title"><img src="https://115.com/favicon.ico" style="width: 48px; height: 48px; border-radius: 4px;"></div>
          <div class="push115-header">
              <span class="push115-header-title">115离线下载助手</span>
              <div class="push115-header-btns">
                  <a class="push115-header-btn" href="https://github.com/gangz1o/sehuatang-to-115" target="_blank" title="访问 Github 项目主页" style="text-decoration: none;">
                      <svg height="16" width="16" viewBox="0 0 16 16" version="1.1" fill="currentColor">
                          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path>
                      </svg>
                  </a>
                  <button class="push115-header-btn" id="push115-minimize" title="最小化">−</button>
              </div>
          </div>
          <div class="push115-content">
              <div id="push115-status-area"></div>
              <div id="push115-progress" class="push115-progress hidden">
                  <div class="push115-progress-text" id="push115-progress-text">处理中...</div>
                  <div class="push115-progress-track">
                      <div class="push115-progress-bar" id="push115-progress-bar"></div>
                  </div>
              </div>

              <div class="push115-section">
                  <label class="push115-label">离线保存路径（格式：名称:CID）</label>
                  <input type="text" class="push115-input" id="push115-path-combo" placeholder="例如：98预处理:123456789">
                  <div class="push115-hint">CID 可在 115 网盘 URL 中找到，0 表示根目录</div>
              </div>

              <div class="push115-divider"></div>

              <div class="push115-section">
                  <div class="push115-checkbox-group">
                      <input type="checkbox" class="push115-checkbox" id="push115-auto-delete">
                      <label class="push115-checkbox-label" for="push115-auto-delete">自动删除小文件</label>
                  </div>
              </div>

              <div class="push115-section" id="push115-delete-section" style="display: none;">
                  <div class="push115-row">
                      <span>删除小于</span>
                      <input type="number" class="push115-input" id="push115-delete-size" style="width: 80px;" min="1" value="100">
                      <span>MB 的文件</span>
                  </div>
              </div>

              <div class="push115-section">
                  <div class="push115-checkbox-group">
                      <input type="checkbox" class="push115-checkbox" id="push115-auto-organize">
                      <label class="push115-checkbox-label" for="push115-auto-organize">自动整理视频到文件夹</label>
                  </div>
                  <div class="push115-hint">将视频移动到以文件名命名的文件夹中</div>
              </div>

              <div class="push115-section" style="display: flex; gap: 8px;">
                  <button class="push115-btn push115-btn-primary" id="push115-check-login" style="flex: 1; padding: 10px 10px; display: flex; align-items: center; justify-content: center; gap: 6px;">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11 19C15.4183 19 19 15.4183 19 11C19 6.58172 15.4183 3 11 3C6.58172 3 3 6.58172 3 11C3 15.4183 6.58172 19 11 19Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 21L16.65 16.65" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                      检查状态
                  </button>
                  <button class="push115-btn push115-btn-secondary" id="push115-login-btn" style="flex: 1; padding: 10px 10px; display: flex; align-items: center; justify-content: center; gap: 6px;">
                      <img src="https://115.com/favicon.ico" style="width: 16px; height: 16px; border-radius: 4px;">
                      扫码登录
                  </button>
              </div>
          </div>
      `

		document.body.appendChild(panel)

		// 根据保存的状态设置面板折叠状态
		if (getConfig(CONFIG_KEYS.PANEL_MINIMIZED)) {
			panel.classList.add('minimized')
		}

		// 初始化配置值
		const savedPath = getConfig(CONFIG_KEYS.SAVE_PATH)
		const savedCid = getConfig(CONFIG_KEYS.SAVE_PATH_CID)
		if (savedPath && savedCid && savedCid !== '0') {
			document.getElementById('push115-path-combo').value = `${savedPath}:${savedCid}`
		} else if (savedCid && savedCid !== '0') {
			document.getElementById('push115-path-combo').value = savedCid
		}

		document.getElementById('push115-auto-organize').checked = getConfig(CONFIG_KEYS.AUTO_ORGANIZE)
		document.getElementById('push115-auto-delete').checked = getConfig(CONFIG_KEYS.AUTO_DELETE_SMALL)
		document.getElementById('push115-delete-size').value = getConfig(CONFIG_KEYS.DELETE_SIZE_THRESHOLD)

		// 显示/隐藏删除设置
		if (getConfig(CONFIG_KEYS.AUTO_DELETE_SMALL)) {
			document.getElementById('push115-delete-section').style.display = 'block'
		}

		// 绑定事件
		bindPanelEvents()

		return panel
	}

	// 绑定面板事件
	function bindPanelEvents() {
		// 最小化按钮
		document.getElementById('push115-minimize').addEventListener('click', () => {
			document.getElementById('push115-panel').classList.add('minimized')
			setConfig(CONFIG_KEYS.PANEL_MINIMIZED, true)
		})

		// 点击最小化图标恢复
		document.querySelector('.push115-min-icon').addEventListener('click', () => {
			document.getElementById('push115-panel').classList.remove('minimized')
			setConfig(CONFIG_KEYS.PANEL_MINIMIZED, false)
		})

		// 保存路径（名称:CID 格式）
		document.getElementById('push115-path-combo').addEventListener('change', e => {
			const value = e.target.value.trim()
			if (value.includes(':')) {
				const parts = value.split(':')
				const name = parts.slice(0, -1).join(':')
				const cid = parts[parts.length - 1]
				setConfig(CONFIG_KEYS.SAVE_PATH, name)
				setConfig(CONFIG_KEYS.SAVE_PATH_CID, cid || '0')
			} else if (/^\d+$/.test(value)) {
				setConfig(CONFIG_KEYS.SAVE_PATH, '')
				setConfig(CONFIG_KEYS.SAVE_PATH_CID, value)
			} else {
				setConfig(CONFIG_KEYS.SAVE_PATH, value)
				setConfig(CONFIG_KEYS.SAVE_PATH_CID, '0')
			}
		})

		// 自动删除开关
		document.getElementById('push115-auto-delete').addEventListener('change', e => {
			setConfig(CONFIG_KEYS.AUTO_DELETE_SMALL, e.target.checked)
			document.getElementById('push115-delete-section').style.display = e.target.checked ? 'block' : 'none'
		})

		// 删除阈值
		document.getElementById('push115-delete-size').addEventListener('change', e => {
			setConfig(CONFIG_KEYS.DELETE_SIZE_THRESHOLD, parseInt(e.target.value) || 100)
		})

		// 自动整理开关
		document.getElementById('push115-auto-organize').addEventListener('change', e => {
			setConfig(CONFIG_KEYS.AUTO_ORGANIZE, e.target.checked)
		})

		// 检查登录状态
		document.getElementById('push115-check-login').addEventListener('click', async () => {
			const btn = document.getElementById('push115-check-login')
			btn.disabled = true
			btn.innerHTML = '<span class="push115-loading"></span>检查中...'

			try {
				const isLoggedIn = await api.checkLogin()
				if (isLoggedIn) {
					showStatus('success', ' 已登录 115 网盘')
				} else {
					showStatus('error', ' 未登录，请先访问 115.com 登录')
				}
			} catch (e) {
				showStatus('error', '检查失败: ' + e.message)
			} finally {
				btn.disabled = false
				btn.textContent = '检查115登录状态'
			}
		})

		// 扫码登录按钮
		document.getElementById('push115-login-btn').addEventListener('click', () => {
			createLoginModal()
		})
	}

	// 显示状态信息
	function showStatus(type, message, durationMs = 5000) {
		const statusArea = document.getElementById('push115-status-area')
		statusArea.innerHTML = `<div class="push115-status ${type}">${message}</div>`
		if (durationMs > 0) {
			setTimeout(() => {
				statusArea.innerHTML = ''
			}, durationMs)
		}
	}

	function setProcessingState(active, message = '') {
		const progressEl = document.getElementById('push115-progress')
		const textEl = document.getElementById('push115-progress-text')
		const barEl = document.getElementById('push115-progress-bar')
		if (!progressEl || !textEl || !barEl) return

		if (!active) {
			progressEl.classList.add('hidden')
			return
		}

		progressEl.classList.remove('hidden')
		textEl.textContent = message || '处理中...'
		barEl.classList.remove('determinate')
		barEl.style.width = '30%'
	}

	function extractVideoCode(rawName) {
		if (!rawName) return ''

		let name = rawName
			.toString()
			.replace(/\.[^.]+$/, '')
			.toUpperCase() // 去后缀，转大写

		// 替换干扰符号为标准连字符 '-'
		// 将 [xx], 【xx】, (xx) 替换为空格
		name = name
			.replace(/\[[^\]]*\]/g, ' ')
			.replace(/【[^】]*】/g, ' ')
			.replace(/\([^\)]*\)/g, ' ')
			.replace(/[@_.]/g, '-') // 关键：把 @, _, . 都变成 -

		// 清洗非核心字符，保留 A-Z, 0-9 和 -
		name = name.replace(/[^A-Z0-9-]/g, ' ')

		// 合并多余的空格或连字符 (例如 A--B 变成 A-B)
		name = name.replace(/[\s-]+/g, '-')

		// 处理 FC2 系列 (FC2-PPV-123456 或 FC2-123456)
		// 逻辑：匹配 FC2 开头，中间可能有 PPV，后面跟着 5-7 位数字
		const fc2Match = name.match(/(FC2-(?:PPV-)?)(\d{5,7})/)
		if (fc2Match) {
			return `${fc2Match[1]}${fc2Match[2]}`
		}
		// 黑名单：如果提取出的前缀是这些，说明提取错了
		const invalidPrefixes = [
			'FULL',
			'H264',
			'HEVC',
			'MP4',
			'AVI',
			'MKV',
			'WMV',
			'JPG',
			'PNG',
			'COM',
			'NET',
			'WWW',
			'JAV',
			'HD',
			'FHD',
			'1080P',
			'720P',
			'4K',
			'RESTORE',
			'UNCENSORED',
			'CHINESE',
			'ARCHIVE',
			'XXX',
		]
		const regexGeneral = /\b([A-Z]{2,6})-(\d{2,5})(?:-([A-Z]))?\b/g

		let match
		while ((match = regexGeneral.exec(name)) !== null) {
			const prefix = match[1]
			// 检查黑名单
			if (!invalidPrefixes.includes(prefix)) {
				const suffix = match[3] ? `-${match[3]}` : ''
				return `${prefix}-${match[2]}${suffix}`
			}
		}

		const compact = name.replace(/-/g, '') // 去掉连字符，只看字符
		// 稍微放宽正则，允许 fallback
		const fallbackMatch = compact.match(/([A-Z]{2,6})(\d{2,5})([A-Z])?$/)

		if (fallbackMatch && !invalidPrefixes.includes(fallbackMatch[1])) {
			const suffix = fallbackMatch[3] ? `-${fallbackMatch[3]}` : ''
			return `${fallbackMatch[1]}-${fallbackMatch[2]}${suffix}`
		}

		return '' // 实在提取不到
	}

	function normalizeCode(value) {
		return (value || '')
			.toString()
			.toUpperCase()
			.replace(/\[[^\]]*\]/g, '')
			.replace(/【[^】]*】/g, '')
			.replace(/\([^\)]*\)/g, '')
			.replace(/[^A-Z0-9]+/g, '')
	}

	// 创建确认弹窗
	function createConfirmModal(linkUrl, linkType) {
		const existingModal = document.getElementById('push115-modal-overlay')
		if (existingModal) {
			existingModal.remove()
		}

		const overlay = document.createElement('div')
		overlay.className = 'push115-modal-overlay'
		overlay.id = 'push115-modal-overlay'

		const savePath = getConfig(CONFIG_KEYS.SAVE_PATH)
		const savePathCid = getConfig(CONFIG_KEYS.SAVE_PATH_CID)
		const autoOrganize = getConfig(CONFIG_KEYS.AUTO_ORGANIZE)
		const autoDelete = getConfig(CONFIG_KEYS.AUTO_DELETE_SMALL)
		const deleteSize = getConfig(CONFIG_KEYS.DELETE_SIZE_THRESHOLD)
		const displayPath = savePath || (savePathCid === '0' ? '根目录' : `CID: ${savePathCid}`)

		const hasAutoTasks = autoOrganize || autoDelete

		overlay.innerHTML = `
          <div class="push115-modal">
              <div class="push115-modal-header">
                  <h3 class="push115-modal-title">📥 推送到 115 网盘</h3>
              </div>
              <div class="push115-modal-body">
                  <div class="push115-modal-info">检测到 <strong>${linkType}</strong> 链接：</div>
                  <div class="push115-modal-link">${linkUrl}</div>
                  <div class="push115-modal-info">保存路径：<strong>${displayPath}</strong></div>
                  ${autoDelete ? `<div class="push115-modal-info">🗑️ 自动删除小于 ${deleteSize}MB 的文件</div>` : ''}
                  ${autoOrganize ? `<div class="push115-modal-info">📁 自动整理视频到文件夹</div>` : ''}
                  ${hasAutoTasks ? `<div class="push115-modal-info" style="color: #e65100;">⚠️ 请保持此页面打开直到处理完成</div>` : ''}
              </div>
              <div class="push115-modal-footer">
                  <button class="push115-btn push115-btn-secondary" id="push115-modal-cancel">取消</button>
                  <button class="push115-btn push115-btn-primary" id="push115-modal-confirm">确定推送</button>
              </div>
          </div>
      `

		document.body.appendChild(overlay)

		// 绑定事件
		document.getElementById('push115-modal-cancel').addEventListener('click', () => {
			overlay.remove()
		})

		document.getElementById('push115-modal-confirm').addEventListener('click', async () => {
			// 展开面板以便查看任务进度
			expandPanel()

			const confirmBtn = document.getElementById('push115-modal-confirm')
			confirmBtn.disabled = true
			confirmBtn.innerHTML = '<span class="push115-loading"></span>推送中，请保持页面打开...'

			try {
				const result = await api.addOfflineTask(linkUrl)
				overlay.remove()
				showStatus('success', `🎉 推送成功: ${result.name || '离线任务已添加'}`)
				GM_notification({
					title: '115 离线下载',
					text: `🎉 推送成功: ${result.name || '任务已添加'}`,
					timeout: 3000,
				})

				// 如果开启了自动处理，启动监控
				const autoOrganize = getConfig(CONFIG_KEYS.AUTO_ORGANIZE)
				const autoDelete = getConfig(CONFIG_KEYS.AUTO_DELETE_SMALL)
				if (autoOrganize || autoDelete) {
					const taskMeta = {
						id: result.info_hash || result.name || linkUrl,
						name: result.name || '',
					}
					monitorAndProcess(taskMeta)
				} else {
					// 如果没有自动处理任务，推送成功后延迟 3 秒折叠面板
					setTimeout(() => {
						collapsePanel()
					}, 3000)
				}
			} catch (e) {
				confirmBtn.disabled = false
				confirmBtn.textContent = '确定推送'
				showStatus('error', ' 推送失败: ' + e.message)
			}
		})

		// 点击遮罩关闭
		overlay.addEventListener('click', e => {
			if (e.target === overlay) {
				overlay.remove()
			}
		})

		// ESC 关闭
		const escHandler = e => {
			if (e.key === 'Escape') {
				overlay.remove()
				document.removeEventListener('keydown', escHandler)
			}
		}
		document.addEventListener('keydown', escHandler)
	}

	// 创建登录弹窗
	function createLoginModal() {
		const existingModal = document.getElementById('push115-modal-overlay')
		if (existingModal) existingModal.remove()

		const overlay = document.createElement('div')
		overlay.className = 'push115-modal-overlay'
		overlay.id = 'push115-modal-overlay'

		// 115 App 列表
		const apps = [
			{ name: '115 (网页端)', value: 'web' },
			{ name: '115 (iOS端)', value: 'ios' },
			{ name: '115 (Android端)', value: 'android' },
			{ name: '115 (iPad端)', value: 'ipad' },
			{ name: '115 (Android电视端)', value: 'tv' },
			{ name: '115管理 (iOS端)', value: 'qios' },
			{ name: '115管理 (Android端)', value: 'qandroid' },
			{ name: '115生活 (微信小程序)', value: 'wechatmini' },
			{ name: '115生活 (支付宝小程序)', value: 'alipaymini' },
		]

		overlay.innerHTML = `
			<div class="push115-modal" style="width: 340px;">
				<div class="push115-modal-header">
					<h3 class="push115-modal-title"><img src="https://115.com/favicon.ico" style="width: 24px; height: 24px; border-radius: 4px;"> 115 扫码登录</h3>
				</div>
				<div class="push115-modal-body">
					<!-- 选择区域 -->
					<div id="push115-login-select-area">
						<div class="push115-label" style="text-align: center; margin-bottom: 12px;">请选择登录应用类型</div>
						<div class="push115-section">
							<div class="push115-select-wrapper">
								<select id="push115-app-select" class="push115-select">
									${apps.map(app => `<option value="${app.value}">${app.name}</option>`).join('')}
								</select>
							</div>
						</div>
						<div class="push115-hint" style="text-align: center; margin-bottom: 20px;">不同端登录状态可能独立，建议选择长期使用的端</div>
						<button class="push115-btn push115-btn-primary" id="push115-login-start" style="width: 100%;">
							开始扫码
						</button>
					</div>

					<!-- 二维码区域 (初始隐藏) -->
					<div id="push115-qrcode-area" style="display: none;">
						<div class="push115-qrcode-container">
							<div id="push115-qrcode-wrapper" style="display: flex; justify-content: center; align-items: center; height: 200px;">
								<span class="push115-loading" style="border-width: 3px; width: 30px; height: 30px; border-top-color: #007AFF; border-color: rgba(0,122,255,0.2);"></span>
							</div>
							<div class="push115-qrcode-status" id="push115-qrcode-status">正在获取二维码...</div>
							<div class="push115-qrcode-tip" id="push115-qrcode-tip">请使用 115 App 扫码</div>
						</div>
					</div>
				</div>
				<div class="push115-modal-footer">
					<button class="push115-btn push115-btn-secondary" id="push115-modal-cancel">取消</button>
				</div>
			</div>
		`

		document.body.appendChild(overlay)

		let stopPolling = false
		let selectedApp = 'web'

		const cleanup = () => {
			stopPolling = true
			overlay.remove()
			document.removeEventListener('keydown', escHandler)
		}

		// 绑定关闭事件
		document.getElementById('push115-modal-cancel').addEventListener('click', cleanup)
		overlay.addEventListener('click', e => {
			if (e.target === overlay) cleanup()
		})

		const escHandler = e => {
			if (e.key === 'Escape') cleanup()
		}
		document.addEventListener('keydown', escHandler)

		// 默认选中 Android (通常更持久)
		const appSelect = document.getElementById('push115-app-select')
		appSelect.value = 'android'

		// 应用描述映射
		const appDescriptions = {
			web: '请使用 115 App 扫码',
			ios: '请使用 115 App (iOS端) 扫码',
			android: '请使用 115 App (Android端) 扫码',
			ipad: '请使用 115 App (iPad端) 扫码',
			tv: '请使用 115 App (Android电视端) 扫码',
			qios: '请使用 115管理 App (iOS端) 扫码',
			qandroid: '请使用 115管理 App (Android端) 扫码',
			wechatmini: '请使用 微信 扫码 (115生活小程序)',
			alipaymini: '请使用 支付宝 扫码 (115生活小程序)',
		}

		// 更新提示文本
		const updateTip = () => {
			const tipEl = document.getElementById('push115-qrcode-tip')
			const val = appSelect.value
			if (tipEl && appDescriptions[val]) {
				tipEl.textContent = appDescriptions[val]
			}
		}

		// 监听选择变化
		appSelect.addEventListener('change', updateTip)

		// 初始化提示
		updateTip()

		// 点击开始按钮
		document.getElementById('push115-login-start').addEventListener('click', () => {
			selectedApp = document.getElementById('push115-app-select').value
			document.getElementById('push115-login-select-area').style.display = 'none'
			document.getElementById('push115-qrcode-area').style.display = 'block'
			startLoginFlow()
		})

		// 启动登录流程
		const startLoginFlow = async () => {
			try {
				// 1. 获取 Token
				const tokenData = await api.getQRCodeToken()
				const { uid, time, sign, qrcode } = tokenData

				// 2. 显示二维码
				const wrapper = document.getElementById('push115-qrcode-wrapper')
				if (wrapper) {
					wrapper.innerHTML = `<img src="https://qrcodeapi.115.com/api/1.0/web/1.0/qrcode?uid=${uid}&_=${Date.now()}" class="push115-qrcode-img">`
				}

				const statusEl = document.getElementById('push115-qrcode-status')
				if (statusEl) statusEl.textContent = '请扫描二维码'

				// 3. 轮询状态
				while (!stopPolling) {
					try {
						const statusData = await api.getQRCodeStatus(uid, time, sign)
						const status = statusData.status // 0:等待, 1:已扫码, 2:已登录, -1:过期, -2:取消

						if (status === 0) {
							if (statusEl) statusEl.textContent = '请扫描二维码'
						} else if (status === 1) {
							if (statusEl) statusEl.textContent = '已扫码，请在手机上确认'
						} else if (status === 2) {
							if (statusEl) statusEl.textContent = '登录成功！正在获取 Cookie...'

							// 4. 换取 Cookie (带 App 参数)
							try {
								await api.loginQRCode(uid, selectedApp)
								if (statusEl) statusEl.textContent = ' 登录完成'

								// 短暂延迟后关闭
								setTimeout(() => {
									cleanup()
									showStatus('success', ` 115 登录成功 (${selectedApp})，Cookie 已保存`)
								}, 1000)
							} catch (loginErr) {
								console.error('Login Error:', loginErr)
								if (statusEl) statusEl.textContent = ' 获取Cookie失败: ' + loginErr.message
								// Stop polling on critical failure to avoid infinite loop
								stopPolling = true
							}
							break
						} else if (status === -1) {
							if (statusEl) statusEl.textContent = '二维码已过期，请重试'
							break
						} else if (status === -2) {
							if (statusEl) statusEl.textContent = '已取消登录'
							break
						}

						await new Promise(r => setTimeout(r, 1500))
					} catch (e) {
						console.error('轮询状态错误:', e)
						// 继续轮询，除非连续多次错误（这里简化处理）
						await new Promise(r => setTimeout(r, 2000))
					}
				}
			} catch (e) {
				console.error('登录流程错误:', e)
				const statusEl = document.getElementById('push115-qrcode-status')
				if (statusEl) statusEl.textContent = ' 发生错误: ' + e.message
			}
		}
	}

	// ========== 监控任务并处理 ==========
	async function monitorAndProcess(taskMeta) {
		const taskId = taskMeta?.id || taskMeta
		let taskName = taskMeta?.name || ''
		let taskFileCid = ''

		console.log(`[监控] 开始监控任务: ${taskId}`)
		showStatus('warning', '⏳ 正在监控离线任务，完成后自动处理\n请保持此页面打开！', 0)
		setProcessingState(true, '正在监控任务...')

		const maxAttempts = 120
		const interval = 10000
		let attempts = 0
		let completed = false

		const checkTask = async () => {
			attempts++
			if (attempts > maxAttempts) {
				showStatus('error', '监控超时，请手动检查', 0)
				setProcessingState(false)
				setTimeout(() => {
					collapsePanel()
				}, 3000)
				return
			}

			try {
				const tasks = await api.getOfflineTasks()
				const task = tasks.find(t => t.info_hash === taskId || t.name === taskId)

				console.log(`[监控] 第 ${attempts} 次检查`)
				if (task) {
					showStatus('info', '⏳ 任务进行中...', 0)
					setProcessingState(true, '任务进行中...')
				} else {
					showStatus('info', `⏳ 正在监控任务...（第 ${attempts} 次检查）`, 0)
					setProcessingState(true, `正在监控任务...（第 ${attempts} 次检查）`)
				}

				if (task) {
					if (!taskName && task.name) {
						taskName = task.name
					}
					if (!taskFileCid) {
						taskFileCid = task.file_id || task.fileId || task.dir_id || task.dirId || task.wppath_id || ''
					}
					if (task.status === 2 || task.percentDone === 100) {
						if (!completed) {
							completed = true
							showStatus('info', ' 任务完成，开始处理文件...', 0)
							setProcessingState(true, '任务完成，开始处理文件...')
							setTimeout(() => processFiles({ taskName, taskFileCid }), 5000)
						}
						return
					}
					if (task.status === -1) {
						showStatus('error', '离线任务失败', 0)
						setProcessingState(false)
						setTimeout(() => {
							collapsePanel()
						}, 3000)
						return
					}
				} else {
					if (!completed) {
						completed = true
						setProcessingState(true, '任务完成，开始处理文件...')
						setTimeout(() => processFiles({ taskName, taskFileCid }), 5000)
					}
					return
				}

				setTimeout(checkTask, interval)
			} catch (e) {
				console.error('[监控] 检查失败:', e)
				setTimeout(checkTask, interval)
			}
		}

		const resolveTaskFolderCid = async (saveCid, name, fileCid) => {
			if (fileCid) {
				return { cid: fileCid, found: true, label: '任务文件夹' }
			}
			if (!name) {
				return { cid: saveCid, found: false, label: '保存路径' }
			}

			const list = await api.getFileList(saveCid)
			if (!list.data || !Array.isArray(list.data)) {
				return { cid: saveCid, found: false, label: '保存路径' }
			}

			const normalize = v => (v || '').toString().trim().toLowerCase()
			const taskNameNorm = normalize(name)
			const folders = list.data.filter(item => !item.sha)

			const exact = folders.find(item => normalize(item.n || item.name) === taskNameNorm)
			if (exact) {
				return { cid: exact.cid || exact.fid, found: true, label: '任务文件夹' }
			}

			const fuzzy = folders.find(item => normalize(item.n || item.name).includes(taskNameNorm))
			if (fuzzy) {
				return { cid: fuzzy.cid || fuzzy.fid, found: true, label: '任务文件夹' }
			}

			return { cid: saveCid, found: false, label: '保存路径' }
		}

		const resolveFolderNameByCid = async (parentCid, folderCid) => {
			if (!parentCid || !folderCid) return ''
			const list = await api.getFileList(parentCid)
			if (!list.data || !Array.isArray(list.data)) return ''
			const folder = list.data.find(item => !item.sha && (item.cid === folderCid || item.fid === folderCid))
			return folder ? folder.n || folder.name || '' : ''
		}

		const processFiles = async (context = {}) => {
			const saveCid = getConfig(CONFIG_KEYS.SAVE_PATH_CID)
			const autoDelete = getConfig(CONFIG_KEYS.AUTO_DELETE_SMALL)
			const autoOrganize = getConfig(CONFIG_KEYS.AUTO_ORGANIZE)
			let messages = []

			showStatus('info', '⚙️ 正在处理文件...', 0)
			setProcessingState(true, '正在处理文件...')

			try {
				const targetInfo = await resolveTaskFolderCid(saveCid, context.taskName, context.taskFileCid)
				if (!targetInfo.found) {
					showStatus('warning', '未找到本次任务的文件夹，已跳过自动处理（避免扫描整个目录）', 0)
					setProcessingState(false)
					setTimeout(() => {
						collapsePanel()
					}, 3000)
					return
				}

				const cid = targetInfo.cid
				console.log(`[处理] 仅处理${targetInfo.label}: CID=${cid}`)
				const rawTaskName =
					context.taskName || (await resolveFolderNameByCid(saveCid, context.taskFileCid || cid)) || ''
				const taskCode = extractVideoCode(rawTaskName)
				const taskNameNorm = normalizeCode(rawTaskName)
				const taskCodeNorm = normalizeCode(taskCode || '')
				const useParentCid = taskCode && taskNameNorm && taskCodeNorm && taskNameNorm !== taskCodeNorm
				const organizeParentCid = useParentCid ? saveCid : null
				const organizeFolderName = useParentCid ? '' : rawTaskName || ''
				if (taskCode && taskNameNorm && taskCodeNorm && taskNameNorm !== taskCodeNorm) {
					const folderId = context.taskFileCid || cid
					const renameResult = await api.renameFileOrFolder(folderId, taskCode)
					if (renameResult.state === true) {
						console.log(`[整理] 已重命名任务文件夹: ${rawTaskName || ''} -> ${taskCode}`)
					} else {
						console.log(`[整理] 重命名任务文件夹失败:`, renameResult)
					}
				}

				// 1. 先删除小文件
				if (autoDelete) {
					const threshold = getConfig(CONFIG_KEYS.DELETE_SIZE_THRESHOLD)
					console.log(`[清理] 开始删除小于 ${threshold}MB 的文件`)
					const result = await api.cleanSmallFiles(cid, threshold)
					if (result.deleted > 0) {
						messages.push(`删除 ${result.deleted} 个小文件`)
						console.log(`[清理] 已删除:`, result.files)
					}
				}

				// 2. 再整理视频
				if (autoOrganize) {
					console.log(`[整理] 开始整理视频`)
					const result = await api.organizeVideosToFolders(cid, organizeFolderName, organizeParentCid)
					if (result.organized > 0) {
						messages.push(`整理 ${result.organized} 个视频`)
						console.log(`[整理] 已整理:`, result.files)
					}
				}

				if (messages.length > 0) {
					showStatus('success', ` ${messages.join('，')}`)
					setProcessingState(false)
					GM_notification({
						title: '115 处理完成',
						text: messages.join('，'),
						timeout: 5000,
					})
				} else {
					showStatus('info', '处理完成，没有需要处理的内容')
					setProcessingState(false)
				}
				// 任务处理完成后，延迟 3 秒折叠面板
				setTimeout(() => {
					collapsePanel()
				}, 3000)
			} catch (e) {
				console.error('[处理] 失败:', e)
				showStatus('error', '处理失败: ' + e.message)
				setProcessingState(false)
				// 任务处理失败后，延迟 3 秒折叠面板
				setTimeout(() => {
					collapsePanel()
				}, 3000)
			}
		}

		setTimeout(checkTask, 20000)
	}

	// ========== 链接检测 ==========
	function isMagnetLink(text) {
		return /^magnet:\?xt=urn:[a-z0-9]+:[a-z0-9]{32,}/i.test(text)
	}

	function isEd2kLink(text) {
		return /^ed2k:\/\/\|file\|/i.test(text)
	}

	function getLinkType(text) {
		if (isMagnetLink(text)) return 'Magnet'
		if (isEd2kLink(text)) return 'ED2K'
		return null
	}

	// 监听复制事件
	function setupCopyListener() {
		document.addEventListener('copy', () => {
			setTimeout(async () => {
				try {
					const text = await navigator.clipboard.readText()
					const linkType = getLinkType(text.trim())
					if (linkType) {
						createConfirmModal(text.trim(), linkType)
					}
				} catch (e) {
					const selection = window.getSelection()
					if (selection) {
						const text = selection.toString().trim()
						const linkType = getLinkType(text)
						if (linkType) {
							createConfirmModal(text, linkType)
						}
					}
				}
			}, 100)
		})
	}

	// ========== 初始化 ==========
	function init() {
		// 防止重复初始化
		if (document.getElementById('push115-panel')) return

		createConfigPanel()
		setupCopyListener()
		console.log('[sehuatang to 115] 插件已加载')
	}

	// 尽早初始化：DOM 准备好就执行
	function earlyInit() {
		if (document.body) {
			init()
		} else {
			// 如果 body 还不存在，使用 MutationObserver 监听
			const observer = new MutationObserver((mutations, obs) => {
				if (document.body) {
					obs.disconnect()
					init()
				}
			})
			observer.observe(document.documentElement, { childList: true })
		}
	}

	earlyInit()
})()
