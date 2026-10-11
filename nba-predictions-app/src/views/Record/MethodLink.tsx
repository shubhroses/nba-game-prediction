import { TextLink } from '../../components/ui';
import { hrefOf } from '../../display/route';

/** Leads to the view that says how the two models work, from where the record speaks of them. */
export default function MethodLink() {
  return (
    <TextLink href={hrefOf('method')} standalone className="text-sm">
      How the two models work
    </TextLink>
  );
}
