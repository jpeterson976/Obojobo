const AssessmentScore = require('../models/assessment-score')
const AssessmentModel = require('../models/assessment')
const insertEvents = require('./insert-events')
const logger = require('obojobo-express/logger')
const lti = require('obojobo-express/lti')
const db = require('obojobo-express/db')

const AttemptImport = async (req, res) => {
	// @TODO validate req.body.importedAssessmentScoreId
	if(req.currentVisit.score_importable !== true) throw "Import score used on visit without import enabled"

	// load the AssessmentScore to import
	const originalScore = await AssessmentScore.fetchById(req.body.importedAssessmentScoreId)

	// verify originalScore against current visit data
	if(originalScore.userId !== req.currentUser.id) throw "Importable scores must be owned by the current user."
	if(originalScore.draftId !== req.currentDocument.draftId) throw "Scores can only be imported for the same module"
	if(originalScore.draftContentId !== req.currentDocument.contentId) throw "Scores can only be imported for the same version of a module"

	// check that the student has no attempts for this resource_link yet
	// @TODO: We don't need the full attemptHistory (lots of work) - optimize
	const attemptHistory = await AssessmentModel.fetchAttemptHistory(
		req.currentUser.id,
		req.currentDocument.draftId,
		req.currentVisit.is_preview,
		req.currentVisit.resource_link_id
	)

	if(attemptHistory.length !== 0) throw "Scores can only be imported if no assessment attempts have been made."

	const originalAttempt = await AssessmentModel.fetchAttemptByID(originalScore.attemptId)

	if(originalAttempt.userId !== req.currentUser.id) throw "Original attempt was not created by the current user"

	let importedScore
	let importedAttempt
	await db.tx(transaction => {
		return originalAttempt
			.importAsNewAttempt(req.currentVisit.resource_link_id, transaction)
			.then(importedAttemptResult => {
				importedAttempt = importedAttemptResult
				return originalScore.importAsNewScore(importedAttemptResult.id, req.currentVisit.resource_link_id, transaction)
			})
			.then(importedScoreResult => {
				importedScore = importedScoreResult
			})
	})

	const history = await AssessmentModel.getCompletedAssessmentAttemptHistory(
		req.currentUser.id,
		req.currentDocument.draftId,
		req.params.assessmentId,
		req.currentVisit.is_preview,
		req.currentVisit.resource_link_id
	)

	console.log('HISTORY')
	console.log(history)

	// save an event
	await insertEvents.insertAttemptEndEvents(
		req.currentUser,
		req.currentDocument,
		req.params.assessmentId,
		importedAttempt.id,
		importedAttempt.attemptNumber,
		req.currentVisit.is_preview,
		req.hostname,
		req.connection.remoteAddress
	)

	// send the lti score
	const ltiRequest = await lti.sendHighestAssessmentScore(
		req.currentUser.id,
		req.currentDocument,
		req.params.assessmentId,
		req.currentVisit.is_preview,
		req.currentVisit.resource_link_id
	)

	// save events for the lti scores
	await insertEvents.insertAttemptImportedEvents(
		req.currentUser.id,
		req.currentDocument.draftId,
		req.currentDocument.contentId,
		req.params.assessmentId,
		originalScore.attemptId,
		importedAttempt.id,
		importedScore.id,
		req.currentVisit.is_preview,
		ltiRequest.scoreSent,
		ltiRequest.status,
		ltiRequest.statusDetails,
		ltiRequest.gradebookStatus,
		ltiRequest.ltiAssessmentScoreId,
		req.hostname,
		req.connection.remoteAddress,
		req.currentVisit.resource_link_id
	)

	return {history, importedScore}
}

module.exports = AttemptImport
