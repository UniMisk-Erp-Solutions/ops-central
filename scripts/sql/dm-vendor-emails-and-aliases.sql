-- ============================================================================
-- Demo Org — vendor emails (for Float RFQ) and vendor-side item aliases
-- (for the vendor PO to print in the vendor's own part numbers)
-- ============================================================================
-- Test-only data. Emails use the .example domain, reserved by RFC 2606 so it
-- never resolves and can never reach a real inbox -- Float RFQ can be
-- exercised end to end without risking a real vendor being emailed.
--
-- Vendor part numbers are invented (each vendor's own SKU scheme, distinct
-- from ours) so po_item_language:'vendor' has something real to print instead
-- of falling back to our own naming with every line flagged "unmapped".
-- ============================================================================

do $$
declare
  org uuid := (select id from public.organizations where slug = 'demo');
begin
  if org is null then
    raise exception 'Demo Org (slug=demo) not found';
  end if;

  update public.config
     set data = jsonb_set(
       coalesce(data, '{}'::jsonb),
       '{vendor_emails}',
       coalesce(data->'vendor_emails', '{}'::jsonb) || jsonb_build_object(
         'v-dm-01', 'procurement@cisco-systems.vendor-test.example',
         'v-dm-02', 'sales@juniper-networks.vendor-test.example',
         'v-dm-03', 'quotes@redington.vendor-test.example',
         'v-dm-04', 'sales@ingram-micro.vendor-test.example',
         'v-dm-05', 'quotes@rashi-peripherals.vendor-test.example'
       ),
       true
     )
   where organization_id = org;

  -- One alias per (vendor, product): their own part number and name for it.
  insert into public.item_aliases (organization_id, product_id, scope, party_id, alias_code, alias_name, uom, created_by)
  values
    (org, 'p-dm-01', 'vendor', 'v-dm-01', 'CIS-WS-C24T',  'Catalyst 24-Port Gigabit Switch', 'EA', null),
    (org, 'p-dm-02', 'vendor', 'v-dm-01', 'CIS-PWR-750',  'Redundant Power Supply 750W',      'EA', null),
    (org, 'p-dm-03', 'vendor', 'v-dm-01', 'CIS-SFP-10G',  '10GBASE SFP+ Transceiver',          'EA', null),
    (org, 'p-dm-04', 'vendor', 'v-dm-02', 'JNP-MX-EDGE',  'MX Series Edge Router',             'EA', null),
    (org, 'p-dm-05', 'vendor', 'v-dm-03', 'RED-CBL-C6-2', 'Cat6 Patch Cord 2 Metre',           'EA', null),
    (org, 'p-dm-06', 'vendor', 'v-dm-02', 'JNP-AP-AX01',  'AX Wireless Access Point',          'EA', null),
    (org, 'p-dm-07', 'vendor', 'v-dm-04', 'ING-POE-AT',   'PoE+ Injector 802.3at',             'EA', null),
    (org, 'p-dm-08', 'vendor', 'v-dm-04', 'ING-BRK-AP01', 'Access Point Mount Bracket',        'EA', null),
    (org, 'p-dm-09', 'vendor', 'v-dm-02', 'JNP-SRX-UTM',  'SRX Series UTM Firewall',           'EA', null),
    (org, 'p-dm-10', 'vendor', 'v-dm-05', 'RAS-RMK-1U',   '1U Universal Rack Mount Kit',       'EA', null),
    (org, 'p-dm-11', 'vendor', 'v-dm-05', 'RAS-UPS-3K',   'Online UPS 3KVA Tower',             'EA', null),
    (org, 'p-dm-12', 'vendor', 'v-dm-05', 'RAS-BAT-12V',  'VRLA Battery 12V',                  'EA', null),
    (org, 'p-dm-13', 'vendor', 'v-dm-03', 'RED-CBL-ORG',  'Cable Management Organizer',        'EA', null)
  on conflict (organization_id, product_id, scope, coalesce(party_id, '')) do nothing;
end $$;

select 'vendor_emails' t, jsonb_pretty(data->'vendor_emails')
  from public.config where organization_id = (select id from public.organizations where slug='demo')
union all
select 'vendor aliases', count(*)::text
  from public.item_aliases
 where organization_id = (select id from public.organizations where slug='demo') and scope='vendor';
