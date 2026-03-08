# Owner/Member Role Model (2026-03-08)

## Scope

This change removes the `ADMIN` team role and standardizes team permissions to two roles only:

- `OWNER`
- `MEMBER`

No migration/backward-compatibility path is maintained in this branch.

## Capability Model

`OWNER` and `MEMBER` now share all team-level management capabilities except:

- `canTransferOwnership`: owner only
- `canDeleteProjects`: owner only

Both roles can:

- manage members (add/remove non-owner members)
- manage team API key
- rename team
- delete team
- manage runners / pairing tokens

Owner remains non-removable.

## Ownership Transfer Changes

Ownership transfer now uses email input (not user ID select):

- API input changed from `userId` to `email`
- Email is normalized and validated
- Transfer target must be a joined team member (has linked user account)
- Current owner is demoted to `MEMBER`
- New owner is promoted to `OWNER`

UI flow:

- User enters member email
- Click `Transfer Ownership`
- Client validates format + team membership candidate
- Custom confirmation modal is shown
- Confirm triggers API transfer

## Cleanup

Removed legacy/dead code paths:

- `ADMIN` enum/member role handling
- Team member role editing endpoint behavior (`PATCH /api/teams/[id]/members/[memberId]`)
- Admin-specific i18n keys/copy in team settings/member management
