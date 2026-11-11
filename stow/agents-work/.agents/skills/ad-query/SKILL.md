---
name: ad-query
description: Query the company Windows Active Directory (GROUP.SIEMPELKAMP.COM) read-only from WSL with the admin account t1.rudek. Use when asked to look up AD users, groups, group memberships, computers, OUs, account status, lockouts, password expiry, or other directory data.
---

# Active Directory queries

Run queries with [`scripts/adq.sh`](scripts/adq.sh). It calls Windows PowerShell 5.1 with the RSAT `ActiveDirectory` module and injects `-Credential` (stored for `GROUP\t1.rudek`) and `-Server group.siempelkamp.com` into every `*-AD*` cmdlet. Do not pass these parameters yourself.

```bash
scripts/adq.sh 'Get-ADUser jdoe -Properties mail,Department | Select-Object Name,SamAccountName,mail,Department'
scripts/adq.sh --json 'Get-ADGroupMember "GG-Example" | Select-Object Name,SamAccountName,objectClass'
```

Pass multi-line scripts on stdin with a quoted heredoc (`<<'PS'`) so bash does not expand `$`.

## Rules

- **Read-only.** Use only `Get-AD*`, `Search-ADAccount`, and plain PowerShell for filtering and formatting. Never modify AD; the script refuses write cmdlets. If the user asks for a change, give them the command to run themselves instead.
- Always `Select-Object` the needed properties. `-Properties *` output is huge; avoid it unless explicitly asked.
- Use `--json` when you need to process the result further; otherwise use `Format-Table -AutoSize` or `Format-List` for readability.
- Prefer server-side filters (`-Filter`, `-LDAPFilter`, `-SearchBase`) over `Where-Object` on large result sets. Add `-ResultSetSize` for broad searches.
- When a person is named instead of an account, search first (`Get-ADUser -Filter "Name -like '*Muster*'"`) and confirm ambiguous matches with the user.
- `t1.rudek` cannot read these user attributes on any account; they currently come back empty. Leave them out of default queries and output: `Enabled`, `LockedOut`, `userAccountControl`, `LastLogonDate`, `lastLogonTimestamp`, `PasswordLastSet`, `pwdLastSet`, `msDS-UserPasswordExpiryTimeComputed`, `whenCreated`, `whenChanged`, `msDS-PrincipalName`. If the user explicitly asks for any of them, run the query anyway (permissions may have been extended) and add the requested rows to the table. Only if the values come back empty, report that in the `Hinweis` row as missing read access.
- Report results in the user's language using the output format below. Present dates readably (`dd.MM.yyyy HH:mm`).

## Output format

Unless the user specifies a different format, or authentication fails (see Errors), the final answer is **exactly one Markdown table** with the columns `Feld | Wert` and nothing else: no heading, no prose before or after it, and no second table. Put remarks such as unreadable attributes or ambiguous matches into a `Hinweis` row of the same table.

For a user lookup, use these rows in this order and omit rows whose value is empty:

| Feld | Wert |
|---|---|
| Name | `Name` |
| User logon name (UPN) | `UserPrincipalName` |
| User logon name (pre-Windows 2000) | `GROUP\<SamAccountName>` |
| E-Mail | `mail` |
| Titel | `Title` |
| Abteilung | `Department` |
| Firma | `Company` |
| Standort | `l`, `co` (country name in German) |
| Telefon | `telephoneNumber` |
| Mobil | `mobile` |
| Vorgesetzter | Manager's name (Title) |
| OU | `DistinguishedName` without the CN part |
| Gruppen | group names, comma-separated |
| Hinweis | only if needed |

For other queries (groups, computers, lists), keep the same single `Feld | Wert` table. If there are several results, use one row per object with the object name as `Feld` and the key data as `Wert`.

Default user query:

```bash
scripts/adq.sh <<'PS'
$u = Get-ADUser <sam> -Properties UserPrincipalName,mail,Title,Department,Company,l,co,telephoneNumber,mobile,Manager
$u | Format-List Name,UserPrincipalName,SamAccountName,mail,Title,Department,Company,l,co,telephoneNumber,mobile,DistinguishedName
if ($u.Manager) { Get-ADUser $u.Manager -Properties Title | Format-List Name,Title }
Get-ADPrincipalGroupMembership $u | Select-Object -ExpandProperty Name | Sort-Object
PS
```

Read the manager through `$u.Manager`; do not split the DN string because names like `Traen\, Dirk` contain escaped commas.

## Useful patterns

| Task | Query |
|---|---|
| User details | `Get-ADUser <sam> -Properties mail,Title,Department,Manager` |
| Group memberships of a user | `Get-ADPrincipalGroupMembership <sam> \| Select-Object Name` |
| Members of a group (nested) | `Get-ADGroupMember <group> -Recursive \| Select-Object Name,SamAccountName` |
| Computer info | `Get-ADComputer <name> -Properties OperatingSystem,LastLogonDate,IPv4Address,Description` |
| Find groups | `Get-ADGroup -Filter "Name -like '*<term>*'" \| Select-Object Name,GroupCategory,Description` |

## Errors

### Authentication

If the credential file is missing (exit 4) or the stored password is wrong (`The user name or password is incorrect`), do not retry, because retries can lock the account. Never ask for the password in chat. This replaces the table output: reply with one short sentence naming the cause, followed by these copy-paste commands. Both write the same file. Running one again overwrites a stale credential.

From WSL (bash):

```bash
powershell.exe -NoProfile -Command 'Get-Credential "GROUP\t1.rudek" | Export-Clixml "$env:USERPROFILE\t1-rudek.xml"'
```

From Windows PowerShell:

```powershell
Get-Credential "GROUP\t1.rudek" | Export-Clixml "$env:USERPROFILE\t1-rudek.xml"
```

If `ADQ_USER` or `ADQ_CRED_FILE` are set, use the command that `adq.sh` prints on exit 4 instead, because it uses those values. After the user confirms the setup, run the original query again.

### Other errors
- `Cannot find an object with identity`: the account/group name is wrong; search with `-Filter` instead.
