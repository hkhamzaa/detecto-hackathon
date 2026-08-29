import { isEmail, isPhone, type Errors } from '@/lib/forms'
import type { OrgType } from '@/lib/plans'

/**
 * What an organisation is called, what kind of place it is, and who to reach.
 *
 * The identity half of this — name and type — is the same pair the signup flow
 * asks for, and it is validated by the same function here rather than by a
 * second copy of the rules living in the settings page. Signup and settings are
 * the same question asked twice, and the day they disagree about whether a name
 * is required is the day one of them is wrong.
 *
 * The contact half is not captured at signup. It is the organisation's own
 * contact for the account itself, and it is deliberately separate from two
 * things it could be confused with: the *billing* contact, which lives on the
 * subscription and is where invoices are sent, and a *person's* own email,
 * which belongs to their account and not to the organisation.
 */

export type OrgProfile = {
  name: string
  /** Empty only while somebody is still filling the form in. */
  type: OrgType | ''
  contactEmail: string
  contactPhone: string
}

export type OrgIdentityField = 'name' | 'type'
export type OrgProfileField = OrgIdentityField | 'contactEmail' | 'contactPhone'

/**
 * Name and type. Shared with the signup step that asks for them first.
 *
 * The type is required rather than optional because it is what sizes a
 * deployment, and "Other" is on the list precisely so that requiring it never
 * forces anybody to lie.
 */
export function validateOrgIdentity(
  draft: Pick<OrgProfile, 'name' | 'type'>,
): Errors<OrgIdentityField> {
  const errors: Errors<OrgIdentityField> = {}

  if (!draft.name.trim()) {
    errors.name = 'Enter the name your organisation operates under.'
  }
  if (!draft.type) {
    errors.type = 'Pick the closest match. You can change it later.'
  }

  return errors
}

/**
 * The whole profile, as the settings page saves it.
 *
 * Contact details are required here and absent at signup on purpose: at signup
 * we already have the person who is creating the account, and asking a second
 * time before they have seen the product would be friction for nothing. By the
 * time somebody opens settings, "who does Detecto ring about this account" is a
 * question worth an answer.
 */
export function validateOrgProfile(draft: OrgProfile): Errors<OrgProfileField> {
  const errors: Errors<OrgProfileField> = { ...validateOrgIdentity(draft) }

  if (!draft.contactEmail.trim()) {
    errors.contactEmail = 'Enter an email address for the organisation.'
  } else if (!isEmail(draft.contactEmail)) {
    errors.contactEmail = 'This needs an @ and a domain, like name@company.com.'
  }

  if (!draft.contactPhone.trim()) {
    errors.contactPhone = 'Enter a phone number Detecto can reach you on.'
  } else if (!isPhone(draft.contactPhone)) {
    errors.contactPhone = 'This needs at least 7 digits.'
  }

  return errors
}

/** Trimmed, so a name saved with a stray space is not a different name. */
export function normaliseProfile(draft: OrgProfile): OrgProfile {
  return {
    name: draft.name.trim(),
    type: draft.type,
    contactEmail: draft.contactEmail.trim(),
    contactPhone: draft.contactPhone.trim(),
  }
}
