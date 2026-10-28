/** Keep protected projects read-only while acknowledging a real grade warning. */
async function leaveSavedGradeAsIs(page) {
  const report = await page.evaluate(() => state.session?.grade_notice);
  if (!report?.needs_choice || report.dismissed) return null;
  // Identify the decision by its choices, independent of the title and message.
  const dialog = page.getByRole('dialog')
    .filter({ has: page.getByRole('button', { name: 'Leave as is', exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'Revert to original', exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'Continue without them', exact: true }) });
  await dialog.waitFor({ state: 'visible' });
  console.log('Saved grade notice: Leave as is', JSON.stringify(report.issues));
  await dialog.getByRole('button', { name: 'Leave as is', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  return report;
}
module.exports = { leaveSavedGradeAsIs };
