/**
 * 飞书多维表格 SDK 的测试替身。
 *
 * 真机环境里 `bitable` 由飞书注入到 iframe 里；测试环境没有宿主，
 * 因此在 esbuild 打包时用 --alias 把这个包换成此文件，即可让
 * ImportPanel / ExportPanel / App 在 Node 里真实渲染。
 *
 * `stubState.mode` 用来模拟上传接口的几种真实故障：
 *  - `ok`      正常返回每个文件的 token
 *  - `partial` 返回空数组（批量拿不到 token，应触发逐个兜底）
 *  - `hang`    永不 settle（飞书偶发的挂起，必须靠超时保护兜住）
 */
export const stubState = {
  mode: 'ok' as 'ok' | 'partial' | 'hang',
  /** 记录每次上传调用收到的文件数，便于断言调用序列 */
  calls: [] as number[],
}

/** 每轮用例前清空调用记录 */
export function resetUploadStub() {
  stubState.mode = 'ok'
  stubState.calls = []
}

export const bitable = {
  base: {
    getTableMetaList: async () => [],
    getTableById: async () => ({ id: 'tbl_stub', name: 'stub' }),
    addTable: async () => ({ id: 'tbl_stub' }),
    batchUploadFile: async (files: File[]) => {
      stubState.calls.push(files.length)
      if (stubState.mode === 'hang') {
        // 永不 resolve / reject —— 模拟接口挂起
        return new Promise(() => {})
      }
      if (stubState.mode === 'partial') return []
      return files.map((_f, i) => `tok_${i}`)
    },
  },
  bridge: {
    getBaseUserId: async () => 'stub-user',
  },
}

export default { bitable }
