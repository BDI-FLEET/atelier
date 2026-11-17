import { by } from './part'
export const Row = ({ item }) => <div>{item.text} {by(item)}</div>
