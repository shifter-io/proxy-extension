import { useApp } from '../state/AppState';
import { IspPicker } from './location/IspPicker';
import { ResidentialPicker } from './location/ResidentialPicker';

export function LocationScreen() {
  const { activeMembership } = useApp();
  if (!activeMembership) return null;
  return activeMembership.type === 'isp' ? <IspPicker m={activeMembership} /> : <ResidentialPicker m={activeMembership} />;
}
