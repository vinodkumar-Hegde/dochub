import test from 'node:test';
import assert from 'node:assert/strict';
import {canExportStudentPdf} from './student-pdf-export-policy.js';
import {effectiveDocumentPermissions} from './document-permissions.js';
test('student export denied unless the specific permission is granted',()=>{
 assert.equal(canExportStudentPdf('download',{allowDownload:false,allowPrint:true}),false);
 assert.equal(canExportStudentPdf('print',{allowDownload:true,allowPrint:false}),false);
 assert.equal(canExportStudentPdf('print',{allowDownload:false,allowPrint:true}),true);
 assert.equal(canExportStudentPdf('download',{allowDownload:true,allowPrint:false}),true);
});
test('folder restrictions are maximum permissions for both student exports',()=>{
 const flags=effectiveDocumentPermissions({allowDownload:true,allowPrint:true,folder:{allowDownload:false,allowPrint:true}});
 assert.equal(canExportStudentPdf('download',flags),false);
 assert.equal(canExportStudentPdf('print',flags),true);
});
