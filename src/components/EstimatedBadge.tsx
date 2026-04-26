'use client'

import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface EstimatedBadgeProps {
  reason?: string
}

export function EstimatedBadge({ reason = 'This value was estimated and may not be exact.' }: EstimatedBadgeProps) {
  return (
    <Tooltip>
      <TooltipTrigger>
        <Badge
          variant="outline"
          className="ml-2 border-amber-400 text-amber-600 bg-amber-50 text-[10px] cursor-help"
        >
          Estimated
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p className="text-sm">{reason}</p>
      </TooltipContent>
    </Tooltip>
  )
}
