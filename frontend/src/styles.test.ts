import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import postcss, { type AtRule, type Declaration, type Rule } from 'postcss'

const css = readFileSync(new URL('./App.css', import.meta.url), 'utf8')
const tree = readFileSync(new URL('./components/ProjectTree.tsx', import.meta.url), 'utf8')
const idePage = readFileSync(new URL('./pages/IdePage.tsx', import.meta.url), 'utf8')
const stylesheet = postcss.parse(css, { from: 'src/App.css' })

function rootRule(selector: string): Rule | undefined {
  return stylesheet.nodes.find((node): node is Rule => node.type === 'rule' && node.selector === selector)
}

function declarations(rule: Rule): Map<string, string> {
  const values = new Map<string, string>()
  rule.walkDecls((declaration) => { values.set(declaration.prop, declaration.value) })
  return values
}

test('workbench palette keeps surfaces darker than the background', () => {
  const root = rootRule(':root')
  assert.ok(root)
  const values = declarations(root)
  assert.equal(values.get('--bg'), '#26282c')
  assert.equal(values.get('--surface'), '#191a1c')
})

test('bottom tool window keeps an inset, clipped, rounded surface', () => {
  const panel = rootRule('.bottom-panel')
  assert.ok(panel)
  const values = declarations(panel)
  assert.equal(values.get('margin'), '0')
  assert.equal(values.get('border-radius'), '8px')
  assert.equal(values.get('overflow'), 'hidden')
  assert.equal(values.get('background'), 'var(--surface)')
  assert.equal(declarations(rootRule('.bottom-panels-row')!).get('margin-bottom'), '6px')
  const mainRow = rootRule('.ide-main-row')
  assert.ok(mainRow)
  const mainRowStyles = declarations(mainRow)
  assert.equal(mainRowStyles.get('padding'), '0 calc(var(--tool-stripe-width) + var(--workbench-gap))')
  assert.equal(declarations(rootRule('.bottom-panel-header')!).get('padding'), '0 12px')

  const phone = stylesheet.nodes.find((node): node is AtRule => node.type === 'atrule' && node.name === 'media' && node.params.replace(/\s/g, '') === '(max-width:600px)')
  assert.ok(phone)
  const phonePanel = phone.nodes?.find((node): node is Rule => node.type === 'rule' && node.selector === '.bottom-panels-row')
  assert.ok(phonePanel)
  assert.equal(declarations(phonePanel).get('margin-bottom'), '4px')
  const workbench = phone.nodes?.find((node): node is Rule => node.type === 'rule' && node.selector === '.ide-workbench')
  assert.ok(workbench)
  assert.equal(declarations(workbench).get('--tool-stripe-width'), '34px')
  assert.equal(declarations(workbench).get('--workbench-gap'), '4px')
})

test('mobile dock columns overlay the editor without squeezing it off-screen', () => {
  const phone = stylesheet.nodes.find((node): node is AtRule => node.type === 'atrule' && node.name === 'media' && node.params.replace(/\s/g, '') === '(max-width:600px)')
  assert.ok(phone)
  const mainRow = phone.nodes?.find((node): node is Rule => node.type === 'rule' && node.selector === '.ide-main-row')
  assert.ok(mainRow)
  assert.equal(declarations(mainRow).get('position'), 'relative')
  assert.equal(declarations(mainRow).get('overflow'), 'hidden')
  const columns = phone.nodes?.find((node): node is Rule => node.type === 'rule' && node.selector === '.side-tool-column')
  assert.ok(columns)
  assert.equal(declarations(columns).get('position'), 'absolute')
  assert.equal(declarations(columns).get('width'), 'calc(100vw - 76px)')
  assert.equal(columns.nodes?.find((node): node is Declaration => node.type === 'decl' && node.prop === 'width')?.important, true)
  assert.equal(declarations(columns).get('min-width'), '0')
  const resizeHandle = phone.nodes?.find((node): node is Rule => node.type === 'rule' && node.selector === '.resize-handle')
  assert.ok(resizeHandle)
  assert.equal(declarations(resizeHandle).get('display'), 'none')
})

test('edge stripes do not paint over the bottom panel corners', () => {
  const stripe = rootRule('.tool-stripe,.right-tool-stripe')
  assert.ok(stripe)
  const values = declarations(stripe)
  assert.equal(values.get('background'), 'transparent')
  assert.equal(values.get('position'), 'absolute')
  assert.equal(values.get('border'), '0')
  assert.equal(declarations(rootRule('.tool-stripe')!).get('left'), '0')
  assert.equal(declarations(rootRule('.right-tool-stripe')!).get('right'), '0')
})

test('stylesheet avoids repeated selectors and declarations within the same cascade scope', () => {
  const selectorsByScope = new Map<object, Set<string>>()
  stylesheet.walkRules((rule) => {
    const scope = rule.parent as object
    const selectors = selectorsByScope.get(scope) ?? new Set<string>()
    assert.equal(selectors.has(rule.selector), false, `Duplicate selector ${rule.selector}`)
    selectors.add(rule.selector)
    selectorsByScope.set(scope, selectors)

    const properties = new Set<string>()
    rule.walkDecls((declaration) => {
      assert.equal(properties.has(declaration.prop), false, `Duplicate ${declaration.prop} in ${rule.selector}`)
      properties.add(declaration.prop)
    })
  })
})


test('project tree keeps the root fixed and styles folder disclosure controls', () => {
  assert.match(tree, /tree-root-row/)
  assert.doesNotMatch(tree, /rootOpen|tree-root-toggle/)
  assert.match(tree, /className="folder-toggle"/)
  assert.match(tree, /aria-expanded=\{expanded\}/)
  assert.match(tree, /icons\/intellij\/add\.svg/)
  assert.match(tree, /icons\/intellij\/folder\.svg/)
  assert.match(tree, /icons\/intellij\/chevronRight\.svg/)
  assert.match(tree, /icons\/intellij\/addFile\.svg/)
  assert.match(tree, /icons\/intellij\/addDirectory\.svg/)
  assert.match(css, /\.folder-expanded \.folder-caret/)
  assert.match(css, /\.project-tree-new-button/)
})

test('empty tool-window sides do not render instructional drop panels', () => {
  assert.doesNotMatch(idePage, /Drop a tool window here/)
  assert.doesNotMatch(idePage, /Drop another tool window here to split this side/)
  assert.doesNotMatch(idePage, /<svg/)
  assert.match(idePage, /const showRightColumn = showRightTopPanel \|\| showRightBottomPanel/)
  assert.ok(idePage.includes("toolSides[tool] === 'left'"))
  assert.ok(idePage.includes("toolSides[tool] === 'left-bottom'"))
  assert.ok(idePage.includes('stripe-bottom-divider'))
  assert.ok(idePage.indexOf('stripe-bottom-divider') < idePage.indexOf('stripe-spacer'), 'the split separator belongs immediately below the upper icon group, not at the bottom of the stripe')
  assert.match(css, /\.stripe-bottom-divider \{\s*width: 100%;/)
  const stripeGroup = rootRule('.stripe-drop-group')
  assert.ok(stripeGroup)
  assert.equal(declarations(stripeGroup).get('min-height'), '32px', 'empty stripes must remain usable drop targets')
  assert.match(idePage, /dropOnStripeGroup\(event, 'left-bottom'\)/)
  assert.match(idePage, /dropOnStripeGroup\(event, 'right-bottom'\)/)
  assert.match(idePage, /dropToolWindow\(event, emptySide, targetTool\)/)
  assert.match(idePage, /event\.dataTransfer\.setData\('application\/x-webrains-tool-window', tool\)/)
  assert.doesNotMatch(idePage, /setDockPreviewSide|stripe-drag-source|stripe-drag-placeholder/)
  assert.match(idePage, /filter\(\(button\) => button\.dataset\.toolWindow !== draggedTool\)/)
  assert.doesNotMatch(idePage, /setDragImage|cloneNode\(true\)/)
  assert.match(idePage, /className="bottom-panels-row"/)
})
