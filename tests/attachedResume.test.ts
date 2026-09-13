import { beforeEach, describe, expect, it } from 'vitest'
import {
  archiveResume,
  createItem,
  createResume,
  getItemSummary,
  listItems,
  openDatabase,
  setItemResume
} from '@main/db'

function freshDb(): void {
  openDatabase({ path: ':memory:', reopen: true })
}

/** A master resume plus the tailored variant the apply flow derives from it. */
function masterAndVariant(): { masterId: number; variantId: number } {
  const master = createResume({ label: 'Backend CV', contentMd: '## Skills\n\nGo, SQL\n' })
  const variant = createResume({
    label: 'Backend CV — Northwind',
    contentMd: '## Skills\n\nGo, SQL, Kubernetes\n',
    derivedFromId: master.id
  })
  return { masterId: master.id, variantId: variant.id }
}

describe('the resume an application was sent with', () => {
  beforeEach(freshDb)

  it('resolves a tailored variant, which the library list excludes', () => {
    const { variantId } = masterAndVariant()
    const item = createItem({ company: 'Northwind', role: 'Staff Engineer', statusKey: 'applied' })
    setItemResume(item.id, variantId)

    const summary = getItemSummary(item.id)
    expect(summary?.resume?.id).toBe(variantId)
    expect(summary?.resume?.label).toBe('Backend CV — Northwind')
  })

  it('resolves it on board rows too, not just the inspector', () => {
    const { variantId } = masterAndVariant()
    const item = createItem({ company: 'Northwind', statusKey: 'applied' })
    setItemResume(item.id, variantId)

    const row = listItems().find((i) => i.id === item.id)
    expect(row?.resume?.id).toBe(variantId)
  })

  it('still resolves a resume after it is archived out of the library', () => {
    const { masterId } = masterAndVariant()
    const item = createItem({ company: 'Contoso', statusKey: 'applied' })
    setItemResume(item.id, masterId)
    archiveResume(masterId)

    expect(getItemSummary(item.id)?.resume?.id).toBe(masterId)
  })

  it('is null when no resume has been attached', () => {
    const item = createItem({ company: 'Contoso', statusKey: 'applied' })
    expect(getItemSummary(item.id)?.resume).toBeNull()
  })

  it('is null again once the attachment is cleared', () => {
    const { masterId } = masterAndVariant()
    const item = createItem({ company: 'Contoso', statusKey: 'applied' })
    setItemResume(item.id, masterId)
    setItemResume(item.id, null)

    expect(getItemSummary(item.id)?.resume).toBeNull()
  })
})
