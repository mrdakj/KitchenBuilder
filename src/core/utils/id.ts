import { nanoid } from 'nanoid'

export function makeId(prefix: string) {
  return `${prefix}_${nanoid(8)}`
}
