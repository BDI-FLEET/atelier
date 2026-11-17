import { Heading, Text, Button, Input } from '@atelier/kit'
import { label } from './util'
import { Row } from './lib'
import { twice } from './both'
const { useState, useEffect } = React
const self = window.__atelier.self(import.meta.url)
export default function Module() {
  const [items, setItems] = useState([])
  const load = () => fetch(self.api + '/items').then(r => r.json()).then(setItems)
  useEffect(() => { load(); return self.subscribe(frame => { if (frame.type === 'changed') load() }) }, [])
  return <div className="flex flex-col gap-3"><Heading>{label(twice(items.length))}</Heading>{items.map(i => <Row key={i.id} item={i} />)}</div>
}
