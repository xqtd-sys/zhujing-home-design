/**
 * 从 Openverse（CC0 / 公共领域）抓取家具缩略图到 apps/web/public/furniture/。
 *
 * 用法（需联网）：
 *   node scripts/fetch-furniture-images.mjs
 *
 * 脚本会打印对应的 UPDATE SQL；执行 SQL 后，编辑器左侧素材库就会显示照片。
 * 也可以只用它下载图片，然后手动把 icon_url 改成实际文件名。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const OUT = resolve(process.cwd(), 'apps/web/public/furniture')
const USER_AGENT = 'zhujing-home-design/0.1 (furniture asset fetch; contact: local)'

const ITEMS = [
  { key: 'sofa', name: '沙发', query: 'sofa living room furniture' },
  { key: 'bed', name: '床', query: 'bed bedroom furniture' },
  { key: 'dining-table', name: '餐桌', query: 'dining table furniture' },
  { key: 'cabinet', name: '柜子', query: 'cabinet furniture' },
]

function extensionOf(url) {
  const match = url.match(/\.(jpe?g|png|webp)(?:\?|$)/i)
  if (!match) return 'jpg'
  const ext = match[1].toLowerCase()
  return ext === 'jpeg' ? 'jpg' : ext
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const sql = []

  for (const item of ITEMS) {
    const api = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(item.query)}&page_size=5&license=cc0,pdm&mature=false`
    let results = []
    try {
      const response = await fetch(api, { headers: { 'User-Agent': USER_AGENT } })
      if (!response.ok) {
        console.warn(`[${item.key}] 搜索失败：HTTP ${response.status}`)
        continue
      }
      const data = await response.json()
      results = data.results ?? []
    } catch (error) {
      console.warn(`[${item.key}] 搜索异常：${error.message}`)
      continue
    }

    const candidate = results.find((entry) => entry.thumbnail || entry.url)
    if (!candidate) {
      console.warn(`[${item.key}] 没有找到合适图片`)
      continue
    }

    const source = candidate.thumbnail || candidate.url
    try {
      const imageResponse = await fetch(source, { headers: { 'User-Agent': USER_AGENT } })
      if (!imageResponse.ok) {
        console.warn(`[${item.key}] 下载失败：HTTP ${imageResponse.status}`)
        continue
      }
      const buffer = Buffer.from(await imageResponse.arrayBuffer())
      const file = `${item.key}.${extensionOf(source)}`
      await writeFile(resolve(OUT, file), buffer)
      console.log(`[${item.key}] 已保存 ${file}（${(buffer.length / 1024).toFixed(1)} KB）`)
      console.log(`  来源：${candidate.foreign_landing_url ?? source}`)
      sql.push(`UPDATE furniture_assets SET icon_url = '/furniture/${file}' WHERE name = '${item.name}';`)
    } catch (error) {
      console.warn(`[${item.key}] 下载异常：${error.message}`)
    }
  }

  if (sql.length) {
    console.log('\n=== 执行下面的 SQL（或让后端/我来执行）===')
    sql.forEach((line) => console.log(line))
  } else {
    console.log('\n没有下载到图片。请检查网络，或手动把图片放进 apps/web/public/furniture/。')
  }
}

main()