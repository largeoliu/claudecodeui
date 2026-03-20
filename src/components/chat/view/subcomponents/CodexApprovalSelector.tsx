import { useTranslation } from 'react-i18next';
import PremiumSelector, { type SelectOption } from './PremiumSelector';
import { ShieldCheck, ShieldAlert, ShieldQuestion } from 'lucide-react';
import type { CodexApprovalPolicy } from '../../types/types';
import { cn } from '../../../../lib/utils';

type CodexApprovalSelectorProps = {
  approvalPolicy: CodexApprovalPolicy;
  onApprovalPolicyChange: (policy: CodexApprovalPolicy) => void;
  className?: string;
};

export default function CodexApprovalSelector({
  approvalPolicy,
  onApprovalPolicyChange,
  className = '',
}: CodexApprovalSelectorProps) {
  const { t } = useTranslation('chat');

  const options: SelectOption[] = [
    {
      id: 'untrusted',
      name: t('codex.approvalPolicy.modes.untrusted'),
      icon: ShieldAlert,
      color: 'text-red-400',
    },
    {
      id: 'on-request',
      name: t('codex.approvalPolicy.modes.onRequest'),
      icon: ShieldQuestion,
      color: 'text-amber-400',
    },
    {
      id: 'never',
      name: t('codex.approvalPolicy.modes.never'),
      icon: ShieldCheck,
      color: 'text-emerald-400',
    },
  ];

  return (
    <PremiumSelector
      selectedValue={approvalPolicy}
      options={options}
      onChange={(val) => onApprovalPolicyChange(val as CodexApprovalPolicy)}
      className={cn("w-fit min-w-[120px]", className)}
      triggerIcon={ShieldQuestion}
    />
  );
}
