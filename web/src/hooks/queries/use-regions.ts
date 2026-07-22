import { useQuery } from '@tanstack/react-query';
import { courierApi, RegionsData } from '@/lib/api/courier';

export function useRegions() {
  return useQuery<RegionsData>({
    queryKey: ['shipping-regions'],
    queryFn: () => courierApi.getRegions(),
    staleTime: 1000 * 60 * 60 * 24, // 24 hours, regions don't change often
  });
}
