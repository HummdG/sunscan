'use client'

import { useState, useCallback, useRef } from 'react'
import { Command, CommandInput, CommandList, CommandItem, CommandEmpty } from '@/components/ui/command'
import { Skeleton } from '@/components/ui/skeleton'
import type { OsAddress, OsBuilding } from '@/lib/types'

interface AddressSearchProps {
  onAddressSelected: (address: OsAddress, building: OsBuilding) => void
  defaultValue?: string
}

export function AddressSearch({ onAddressSelected, defaultValue = '' }: AddressSearchProps) {
  const [query, setQuery] = useState(defaultValue)
  const [results, setResults] = useState<OsAddress[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingBuilding, setLoadingBuilding] = useState(false)
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback((q: string) => {
    setQuery(q)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (q.length < 3) {
      setResults([])
      setOpen(false)
      return
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      setOpen(true)
      try {
        const res = await fetch(`/api/os/address?q=${encodeURIComponent(q)}`)
        const data = await res.json()
        setResults(data.results ?? [])
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
  }, [])

  const selectAddress = useCallback(
    async (address: OsAddress) => {
      setQuery(address.address)
      setOpen(false)
      setResults([])
      setLoadingBuilding(true)
      try {
        const res = await fetch(
          `/api/os/building?uprn=${encodeURIComponent(address.uprn)}&lat=${address.lat}&lng=${address.lng}`,
        )
        const data = await res.json()
        onAddressSelected(address, data.building)
      } catch (err) {
        console.error('Building fetch failed:', err)
        // Provide estimated fallback building
        const fallbackBuilding: OsBuilding = {
          footprintPolygon: [
            [address.lng - 0.00006, address.lat - 0.00004],
            [address.lng + 0.00006, address.lat - 0.00004],
            [address.lng + 0.00006, address.lat + 0.00004],
            [address.lng - 0.00006, address.lat + 0.00004],
            [address.lng - 0.00006, address.lat - 0.00004],
          ],
          source: 'estimated',
          areaM2: 80,
        }
        onAddressSelected(address, fallbackBuilding)
      } finally {
        setLoadingBuilding(false)
      }
    },
    [onAddressSelected],
  )

  return (
    <div className="relative w-full">
      <Command shouldFilter={false} className="border rounded-xl shadow-sm">
        <CommandInput
          placeholder="Start typing a UK address..."
          value={query}
          onValueChange={search}
          className="h-12 text-base"
        />
        {open && (
          <CommandList className="max-h-64">
            {loading && (
              <div className="p-3 space-y-2">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            )}
            {!loading && results.length === 0 && query.length >= 3 && (
              <CommandEmpty>No addresses found. Try a different search.</CommandEmpty>
            )}
            {!loading &&
              results.map((addr) => (
                <CommandItem
                  key={addr.uprn}
                  value={addr.uprn}
                  onSelect={() => selectAddress(addr)}
                  className="cursor-pointer py-2 px-3"
                >
                  <div>
                    <div className="font-medium text-sm">{addr.address}</div>
                    <div className="text-xs text-muted-foreground">{addr.postcode}</div>
                  </div>
                </CommandItem>
              ))}
          </CommandList>
        )}
      </Command>
      {loadingBuilding && (
        <div className="mt-2 text-sm text-muted-foreground animate-pulse">
          Fetching building data...
        </div>
      )}
    </div>
  )
}
