// eslint-disable-next-line no-restricted-imports
import type { ResolvedConfig } from 'vitest'
import { assignVitestGlobals, browserHashMap, client, instantiateRunner, loadConfig } from './utils'
import { setupConsoleLogSpy } from './logger'
import { rpc, rpcDone } from './rpc'
import { setupDialogsSpy } from './dialog'
import { BrowserSnapshotEnvironment } from './snapshot'

// @ts-expect-error mocking some node apis
globalThis.process = { env: {}, argv: [], cwd: () => '/', stdout: { write: () => {} }, nextTick: cb => cb() }
globalThis.global = globalThis

let currentModule: string | undefined
const browserIFrames = new Map<string, HTMLIFrameElement>()

const url = new URL(location.href)

function getQueryPaths() {
  return url.searchParams.getAll('path')
}

const ws = client.ws

ws.addEventListener('open', async () => {
  const config: ResolvedConfig = await loadConfig()

  await assignVitestGlobals()

  const paths = getQueryPaths()

  const iFrame = document.getElementById('vitest-ui') as HTMLIFrameElement
  iFrame.setAttribute('src', `${url.pathname}/__vitest__/`.replace('//', '/'))
  const button = document.getElementById('vitest-browser-button') as HTMLButtonElement
  const testTitle = document.getElementById('vitest-browser-runner-tester') as HTMLDivElement
  button.addEventListener('click', () => {
    if (currentModule && browserHashMap.has(currentModule)) {
      const hidden = iFrame.classList.contains('hidden')
      button.innerText = hidden ? 'Show Test UI' : 'Hide Test UI'
      iFrame.classList.toggle('hidden')
      const targetIFrame = browserIFrames.get(currentModule)
      targetIFrame?.classList.remove('show')
      testTitle.innerText = ''
      if (!hidden) {
        testTitle.innerText = `${currentModule.replace(/^\/@fs\//, '')}`
        targetIFrame?.classList.add('show')
      }
    }
  })

  window.addEventListener('storage', (e) => {
    if (e.key === 'vueuse-color-scheme')
      document.documentElement.classList.toggle('dark', e.newValue === 'dark')
  })

  await setupConsoleLogSpy()
  setupDialogsSpy()
  const waitingPaths = [...paths]
  await runTests(paths, config!, async (e) => {
    if (e.data.type === 'done') {
      waitingPaths.splice(waitingPaths.indexOf(e.data.filename))
      if (!waitingPaths.length) {
        await rpcDone()
        await rpc().onDone('no-isolate')
      }
    }
    if (e.data.type === 'navigate') {
      currentModule = e.data.filename
      button.removeAttribute('disabled')
      if (!currentModule)
        button.setAttribute('disabled', 'true')
    }
  })
})

async function runTests(
  paths: string[],
  config: ResolvedConfig,
  navigate: (ev: BroadcastChannelEventMap['message']) => void,
) {
  // need to import it before any other import, otherwise Vite optimizer will hang
  const viteClientPath = '/@vite/client'
  await import(viteClientPath)

  const { channel } = await instantiateRunner()
  channel.addEventListener('message', navigate)

  if (!config.snapshotOptions.snapshotEnvironment)
    config.snapshotOptions.snapshotEnvironment = new BrowserSnapshotEnvironment()

  const now = `${new Date().getTime()}`
  const container = document.getElementById('vitest-browser-runner-container') as HTMLDivElement

  // isolate test on iframes
  paths
    .map(path => (`${config.root}/${path}`).replace(/\/+/g, '/'))
    .forEach((path) => {
      browserHashMap.set(path, [true, now])
      const iFrame = document.createElement('iframe')
      iFrame.setAttribute('loading', 'eager')
      iFrame.classList.add('iframe-test')
      iFrame.setAttribute(
        'src',
        `${url.pathname}/__vitest_test__/${path}.html?browserv=${now}`.replace('//', '/'),
      )
      browserIFrames.set(path, iFrame)
      container.appendChild(iFrame)
    })
}
