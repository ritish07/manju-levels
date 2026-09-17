import { headers } from 'next/headers';
import MarketWorkspace from './market-workspace';

export default async function Page() {
  const requestHeaders = await headers();
  const canViewPositions = requestHeaders.get('x-authenticated-user') === 'ritish';
  return <MarketWorkspace canViewPositions={canViewPositions} />;
}
